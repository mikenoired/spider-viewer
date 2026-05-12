import { createInstallationPhotoCandidates, type RecognizedTextLine } from "./recognition";
import type { InstallationPhotoBoundingBox, InstallationPhotoKnownItem } from "./shared";

const ocrLanguageSet = "eng+rus";
const ocrEngineLstmOnlyMode = 1;
const sparseTextPageSegmentationMode = "11";
const maxOcrImageSidePx = 1800;
const ocrInitialProgress = 5;
const ocrLoadedProgress = 15;
const ocrMinimumRuntimeProgress = 20;
const ocrRuntimeProgressRange = 75;

const ocrCharacterWhitelist =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" +
	"АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя" +
	"-_/.,:;()[] ";

type OcrProgressCallback = (progress: number) => void;

type TesseractWorkerOptions = {
	corePath: string;
	langPath: string;
	workerPath: string;
	cacheMethod: string;
	workerBlobURL: boolean;
	gzip: boolean;
	logger: (message: TesseractLoggerMessage) => void;
	errorHandler: (error: unknown) => void;
};

type TesseractLoggerMessage = {
	progress?: number;
	status?: string;
};

type TesseractWorker = {
	setParameters: (params: Record<string, string>) => Promise<unknown>;
	recognize: (
		image: HTMLCanvasElement,
		options?: Record<string, unknown>,
		output?: Record<string, boolean>
	) => Promise<TesseractRecognizeResult>;
};

type TesseractApi = {
	createWorker: (langs: string, oem: number, options: TesseractWorkerOptions) => Promise<TesseractWorker>;
};

type TesseractModule = Partial<TesseractApi> & {
	default?: Partial<TesseractApi>;
};

type TesseractRecognizeResult = {
	data: {
		text: string;
		blocks: TesseractBlock[] | null;
	};
};

type TesseractBlock = {
	paragraphs: TesseractParagraph[] | null;
};

type TesseractParagraph = {
	lines: TesseractLine[] | null;
};

type TesseractLine = {
	text: string;
	confidence: number;
	bbox: TesseractBoundingBox;
};

type TesseractBoundingBox = {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
};

type PreparedImage = {
	canvas: HTMLCanvasElement;
	imageData: ImageData;
	release: () => void;
};

let activeProgressCallback: OcrProgressCallback | null = null;
let workerPromise: Promise<TesseractWorker> | null = null;

export type InstallationPhotoRecognitionResult = {
	candidates: ReturnType<typeof createInstallationPhotoCandidates>;
	ocrText: string;
};

export async function recognizeInstallationPhoto(
	file: Blob,
	knownItems: InstallationPhotoKnownItem[],
	onProgress: OcrProgressCallback
): Promise<InstallationPhotoRecognitionResult> {
	activeProgressCallback = onProgress;
	onProgress(ocrInitialProgress);

	const preparedImage = await prepareImageForOcr(file);

	try {
		const worker = await getOcrWorker();
		onProgress(ocrLoadedProgress);
		const result = await worker.recognize(preparedImage.canvas, {}, { text: true, blocks: true });
		const lines = readRecognizedLines(result);
		const candidates = createInstallationPhotoCandidates(lines, knownItems, preparedImage.imageData);

		onProgress(100);

		return {
			candidates,
			ocrText: result.data.text,
		};
	} finally {
		preparedImage.release();
		activeProgressCallback = null;
	}
}

function handleTesseractProgress(message: TesseractLoggerMessage) {
	if (!activeProgressCallback || typeof message.progress !== "number") return;

	const progress = ocrMinimumRuntimeProgress + Math.round(message.progress * ocrRuntimeProgressRange);
	activeProgressCallback(Math.min(progress, 99));
}

async function getOcrWorker() {
	workerPromise ??= createOcrWorker();

	return workerPromise;
}

async function createOcrWorker() {
	const tesseract = await getTesseractApi();
	const worker = await tesseract.createWorker(ocrLanguageSet, ocrEngineLstmOnlyMode, {
		workerPath: "/vision/tesseract/worker.min.js",
		corePath: "/vision/tesseract-core",
		langPath: "/vision/tessdata",
		cacheMethod: "write",
		workerBlobURL: false,
		gzip: true,
		logger: handleTesseractProgress,
		errorHandler: () => undefined,
	});

	await worker.setParameters({
		preserve_interword_spaces: "1",
		tessedit_char_whitelist: ocrCharacterWhitelist,
		tessedit_pageseg_mode: sparseTextPageSegmentationMode,
		user_defined_dpi: "300",
	});

	return worker;
}

async function getTesseractApi() {
	const module = (await import("tesseract.js")) as unknown as TesseractModule;
	const createWorker = module.default?.createWorker ?? module.createWorker;

	if (!createWorker) {
		throw new Error("OCR-модуль не загружен.");
	}

	return { createWorker } satisfies TesseractApi;
}

async function prepareImageForOcr(file: Blob): Promise<PreparedImage> {
	const image = await loadDrawableImage(file);
	const canvas = document.createElement("canvas");
	const context = getCanvasContext(canvas);
	const scale = getImageScale(image.width, image.height);

	canvas.width = Math.max(1, Math.round(image.width * scale));
	canvas.height = Math.max(1, Math.round(image.height * scale));
	context.drawImage(image, 0, 0, canvas.width, canvas.height);

	return {
		canvas,
		imageData: context.getImageData(0, 0, canvas.width, canvas.height),
		release: () => releaseDrawableImage(image),
	};
}

function getCanvasContext(canvas: HTMLCanvasElement) {
	const context = canvas.getContext("2d", {
		willReadFrequently: true,
	});

	if (!context) {
		throw new Error("Canvas недоступен для OCR.");
	}

	return context;
}

function getImageScale(width: number, height: number) {
	const largestSide = Math.max(width, height);

	if (largestSide <= maxOcrImageSidePx) return 1;

	return maxOcrImageSidePx / largestSide;
}

async function loadDrawableImage(file: Blob) {
	if ("createImageBitmap" in window) {
		return createImageBitmap(file, {
			imageOrientation: "from-image",
		});
	}

	return loadHtmlImage(file);
}

function loadHtmlImage(file: Blob) {
	return new Promise<HTMLImageElement>((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const image = new Image();

		image.onload = () => {
			URL.revokeObjectURL(url);
			resolve(image);
		};
		image.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error("Не удалось прочитать фото."));
		};
		image.src = url;
	});
}

function releaseDrawableImage(image: ImageBitmap | HTMLImageElement) {
	if ("close" in image) {
		image.close();
	}
}

function readRecognizedLines(result: TesseractRecognizeResult) {
	return (result.data.blocks ?? []).flatMap(readBlockLines);
}

function readBlockLines(block: TesseractBlock) {
	return (block.paragraphs ?? []).flatMap((paragraph) => (paragraph.lines ?? []).map(createRecognizedLine));
}

function createRecognizedLine(line: TesseractLine): RecognizedTextLine {
	return {
		text: line.text,
		confidence: line.confidence,
		boundingBox: createBoundingBox(line.bbox),
	};
}

function createBoundingBox(box: TesseractBoundingBox): InstallationPhotoBoundingBox {
	return {
		left: box.x0,
		top: box.y0,
		width: Math.max(0, box.x1 - box.x0),
		height: Math.max(0, box.y1 - box.y0),
	};
}
