import { recognizeDocumentCanvas } from "@/lib/installation-photo/ocr";
import type { RecognizedTextLine } from "@/lib/installation-photo/recognition";
import { enToRuVisual } from "@/lib/utils";

import { type DocumentCableRow, extractDocumentCableRows, validateTaskDocument } from "./task-documents";

export type DocumentPageResult = {
	page: number;
	preview: string;
	rotation: number;
	text: string;
	rows: DocumentCableRow[];
	error: string | null;
};

export function joinDocumentOcrLines(lines: RecognizedTextLine[]) {
	const rows: Array<{ center: number; height: number; parts: RecognizedTextLine[] }> = [];
	for (const line of [...lines].sort((a, b) => (a.boundingBox?.top ?? 0) - (b.boundingBox?.top ?? 0))) {
		const box = line.boundingBox;
		if (!box) continue;
		const center = box.top + box.height / 2;
		const row = rows.find(
			(item) => Math.abs(item.center - center) <= Math.min(item.height, box.height) * 0.65
		);
		if (row) row.parts.push(line);
		else rows.push({ center, height: box.height, parts: [line] });
	}
	return rows
		.map((row) =>
			row.parts
				.sort((a, b) => a.boundingBox!.left - b.boundingBox!.left)
				.map((part) => part.text)
				.join(" ")
		)
		.join("\n");
}

// Discard coloured backgrounds and long table rules, not handwritten business meaning.
export function cleanDocumentPixels(pixels: ImageData) {
	const { width, height, data } = pixels;
	const ink = new Uint8Array(width * height);
	for (let i = 0; i < ink.length; i++) {
		ink[i] = (data[i * 4]! + data[i * 4 + 1]! + data[i * 4 + 2]!) / 3 < 115 ? 1 : 0;
	}
	const erase = new Uint8Array(ink.length);
	for (let y = 0; y < height; y++) {
		let start = 0;
		for (let x = 0; x <= width; x++) {
			if (x < width && ink[y * width + x]) continue;
			if (x - start >= Math.max(80, width * 0.12)) for (let k = start; k < x; k++) erase[y * width + k] = 1;
			start = x + 1;
		}
	}
	for (let x = 0; x < width; x++) {
		let start = 0;
		for (let y = 0; y <= height; y++) {
			if (y < height && ink[y * width + x]) continue;
			if (y - start >= Math.max(80, height * 0.12)) for (let k = start; k < y; k++) erase[k * width + x] = 1;
			start = y + 1;
		}
	}
	for (let i = 0; i < ink.length; i++) {
		const value = ink[i] && !erase[i] ? 0 : 255;
		data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = value;
		data[i * 4 + 3] = 255;
	}
	return pixels;
}

function canvasForImage(image: CanvasImageSource, width: number, height: number, rotation: number) {
	const canvas = document.createElement("canvas");
	const scale = Math.min(1, 3000 / Math.max(width, height));
	const sideways = rotation % 180 !== 0;
	canvas.width = Math.round((sideways ? height : width) * scale);
	canvas.height = Math.round((sideways ? width : height) * scale);
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) throw new Error("Canvas недоступен для распознавания.");
	context.fillStyle = "white";
	context.fillRect(0, 0, canvas.width, canvas.height);
	context.translate(canvas.width / 2, canvas.height / 2);
	context.rotate((rotation * Math.PI) / 180);
	context.drawImage(image, (-width * scale) / 2, (-height * scale) / 2, width * scale, height * scale);
	context.resetTransform();
	return canvas;
}

async function recognizePage(
	source: HTMLCanvasElement,
	page: number,
	rotation: number | null,
	onProgress: (message: string) => void,
	signal: AbortSignal
) {
	let best: DocumentPageResult | null = null;
	for (const angle of rotation === null ? [0, 90, 180, 270] : [rotation]) {
		signal.throwIfAborted();
		onProgress(`Страница ${page}, поворот ${angle}°`);
		const canvas = canvasForImage(source, source.width, source.height, angle);
		try {
			const preview = canvas.toDataURL("image/jpeg", 0.65);
			const context = canvas.getContext("2d")!;
			context.putImageData(
				cleanDocumentPixels(context.getImageData(0, 0, canvas.width, canvas.height)),
				0,
				0
			);
			const result = await recognizeDocumentCanvas(canvas, (percent) =>
				onProgress(`Страница ${page}, ${angle}°: ${percent}%`)
			);
			signal.throwIfAborted();
			const text = joinDocumentOcrLines(result.lines) || result.text;
			const rows = extractDocumentCableRows(text, page);
			for (const row of rows)
				row.confidence =
					result.lines.find((line) => line.text.toUpperCase().includes(row.cableLabel))?.confidence ?? null;
			if (rows.length > 0) {
				// Both supplied layouts place the number and cable marking in the left third.
				// A second pass on that band avoids interference from equipment and routing columns.
				const band = document.createElement("canvas");
				band.width = Math.ceil(canvas.width * 0.32);
				band.height = canvas.height;
				try {
					band.getContext("2d")!.drawImage(canvas, 0, 0);
					const extra = await recognizeDocumentCanvas(band, () => undefined, "6");
					signal.throwIfAborted();
					for (const row of extractDocumentCableRows(joinDocumentOcrLines(extra.lines) || extra.text, page)) {
						if (!rows.some((current) => enToRuVisual(current.cableLabel) === enToRuVisual(row.cableLabel))) {
							row.confidence =
								extra.lines.find((line) => line.text.toUpperCase().includes(row.cableLabel))?.confidence ??
								null;
							rows.push(row);
						}
					}
				} finally {
					band.width = band.height = 0;
				}
			}
			if (!best || rows.length > best.rows.length)
				best = { page, preview, rotation: angle, text, rows, error: null };
			// A table with several complete cable markings establishes readable orientation.
			if (rows.length >= 5) break;
		} finally {
			canvas.width = canvas.height = 0;
		}
	}
	return best!;
}

export async function recognizeTaskDocument(
	file: File,
	onPage: (page: DocumentPageResult) => void,
	onProgress: (message: string) => void,
	signal: AbortSignal,
	rotation: number | null = null
) {
	const { contentType } = await validateTaskDocument(file);
	if (contentType !== "application/pdf") {
		const image = await createImageBitmap(file, { imageOrientation: "from-image" });
		const source = canvasForImage(image, image.width, image.height, 0);
		try {
			onPage(await recognizePage(source, 1, rotation, onProgress, signal));
		} finally {
			image.close();
			source.width = source.height = 0;
		}
		return;
	}
	const pdfjs = await import("pdfjs-dist");
	pdfjs.GlobalWorkerOptions.rendererSrc = (await import("pdfjs-dist/build/pdf.renderer.min.mjs?url")).default;
	pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
	const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
	try {
		const pdf = await task.promise;
		if (pdf.numPages > 50) throw new Error("Для распознавания разрешено не более 50 страниц PDF.");
		for (let number = 1; number <= pdf.numPages; number++) {
			signal.throwIfAborted();
			const source = document.createElement("canvas");
			try {
				const page = await pdf.getPage(number);
				const original = page.getViewport({ scale: 1 });
				const viewport = page.getViewport({
					scale: Math.min(4, 3000 / Math.max(original.width, original.height)),
				});
				source.width = Math.ceil(viewport.width);
				source.height = Math.ceil(viewport.height);
				await page.render({ canvas: source, viewport }).promise;
				onPage(await recognizePage(source, number, rotation, onProgress, signal));
				page.cleanup();
			} catch (error) {
				signal.throwIfAborted();
				onPage({
					page: number,
					rows: [],
					text: "",
					preview: "",
					rotation: 0,
					error: error instanceof Error ? error.message : String(error),
				});
			} finally {
				source.width = source.height = 0;
			}
		}
	} finally {
		await task.destroy();
	}
}
