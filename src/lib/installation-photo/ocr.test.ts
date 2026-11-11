import { afterAll, expect, it, mock } from "bun:test";

const worker = {
	setParameters: mock(async () => undefined),
	terminate: mock(async () => undefined),
	recognize: mock(async () => ({ data: { text: "", blocks: [] } })),
};
const createWorker = mock(async () => worker);
mock.module("tesseract.js", () => ({ createWorker }));
const { recognizeInstallationPhoto, recognizeDocumentCanvas } = await import("./ocr");
const originalBitmap = globalThis.createImageBitmap;
const originalWindowBitmap = window.createImageBitmap;
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const bitmap = mock(async () => ({ width: 1, height: 1, close() {} }) as ImageBitmap);
Object.defineProperty(window, "createImageBitmap", { configurable: true, value: bitmap });
globalThis.createImageBitmap = bitmap as unknown as typeof createImageBitmap;
HTMLCanvasElement.prototype.getContext = (() => ({
	drawImage() {},
	getImageData: () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }),
})) as unknown as typeof originalGetContext;
afterAll(() => {
	globalThis.createImageBitmap = originalBitmap;
	Object.defineProperty(window, "createImageBitmap", { configurable: true, value: originalWindowBitmap });
	HTMLCanvasElement.prototype.getContext = originalGetContext;
});
it("retries OCR initialization after a transient worker load failure", async () => {
	createWorker.mockRejectedValueOnce(new Error("Network error"));
	await expect(recognizeInstallationPhoto(new Blob(), [], () => undefined)).rejects.toThrow("Network error");
	await expect(recognizeInstallationPhoto(new Blob(), [], () => undefined)).resolves.toMatchObject({
		candidates: [],
	});
	expect(createWorker).toHaveBeenCalledTimes(2);
	expect(worker.recognize).toHaveBeenCalledTimes(1);
});

it("serializes camera and document work on the shared mutable OCR worker", async () => {
	let finish!: (value: { data: { text: string; blocks: [] } }) => void;
	worker.recognize.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			})
	);
	const before = worker.recognize.mock.calls.length;
	const first = recognizeDocumentCanvas(document.createElement("canvas"), () => undefined, "6");
	const second = recognizeInstallationPhoto(new Blob(), [], () => undefined);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(worker.recognize.mock.calls.length).toBe(before + 1);
	finish({ data: { text: "", blocks: [] } });
	await Promise.all([first, second]);
	expect(worker.recognize.mock.calls.length).toBe(before + 2);
});
