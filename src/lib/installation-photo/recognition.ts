import type {
	InstallationPhotoBoundingBox,
	InstallationPhotoCandidate,
	InstallationPhotoKnownItem,
} from "./shared";

const minimumTokenLength = 5;
const highConfidenceThreshold = 70;
const selectedMarkerScoreThreshold = 2;
const markerRedMinimum = 145;
const markerGreenMinimum = 105;
const markerBlueMaximum = 155;
const markerRedBlueDelta = 45;
const markerGreenBlueDelta = 25;
const markerSamplePaddingPx = 8;

const cyrillicLookalikes: Record<string, string> = {
	А: "A",
	В: "B",
	Е: "E",
	К: "K",
	М: "M",
	Н: "H",
	О: "O",
	Р: "P",
	С: "C",
	Т: "T",
	У: "Y",
	Х: "X",
	а: "A",
	в: "B",
	е: "E",
	к: "K",
	м: "M",
	н: "H",
	о: "O",
	р: "P",
	с: "C",
	т: "T",
	у: "Y",
	х: "X",
};

export type RecognizedTextLine = {
	text: string;
	confidence: number;
	boundingBox: InstallationPhotoBoundingBox | null;
};

type CandidateMatch = {
	item: InstallationPhotoKnownItem;
	token: string;
};

export function normalizeInstallationPhotoText(value: string) {
	return [...value]
		.map((char) => cyrillicLookalikes[char] ?? char)
		.join("")
		.toUpperCase()
		.replaceAll("0", "O")
		.replace(/[^A-Z0-9]/g, "");
}

function extractNormalizedTokens(text: string) {
	const tokens = text.split(/[^0-9A-Za-zА-Яа-яЁё]+/g);
	const normalizedTokens = tokens.map(normalizeInstallationPhotoText);

	return normalizedTokens.filter((token) => token.length >= minimumTokenLength);
}

function createKnownItemIndex(items: InstallationPhotoKnownItem[]) {
	const index = new Map<string, InstallationPhotoKnownItem>();

	for (const item of items) {
		const normalizedName = normalizeInstallationPhotoText(item.kksName);

		if (normalizedName.length >= minimumTokenLength) {
			index.set(normalizedName, item);
		}
	}

	return index;
}

function findLineMatches(line: RecognizedTextLine, knownByName: Map<string, InstallationPhotoKnownItem>) {
	const matches: CandidateMatch[] = [];

	for (const token of extractNormalizedTokens(line.text)) {
		const item = knownByName.get(token);

		if (item) {
			matches.push({ item, token });
		}
	}

	return matches;
}

function getMarkerPixelRatio(imageData: ImageData, box: InstallationPhotoBoundingBox | null) {
	if (!box) return 0;

	const bounds = getPaddedBounds(imageData, box);
	let markerPixels = 0;
	let sampledPixels = 0;

	for (let y = bounds.top; y < bounds.bottom; y += 1) {
		for (let x = bounds.left; x < bounds.right; x += 1) {
			const offset = (y * imageData.width + x) * 4;
			markerPixels += isMarkerPixel(imageData.data, offset) ? 1 : 0;
			sampledPixels += 1;
		}
	}

	return sampledPixels === 0 ? 0 : markerPixels / sampledPixels;
}

function getPaddedBounds(imageData: ImageData, box: InstallationPhotoBoundingBox) {
	return {
		left: Math.max(0, Math.floor(box.left - markerSamplePaddingPx)),
		top: Math.max(0, Math.floor(box.top - markerSamplePaddingPx)),
		right: Math.min(imageData.width, Math.ceil(box.left + box.width + markerSamplePaddingPx)),
		bottom: Math.min(imageData.height, Math.ceil(box.top + box.height + markerSamplePaddingPx)),
	};
}

function isMarkerPixel(data: Uint8ClampedArray, offset: number) {
	const red = data[offset] ?? 0;
	const green = data[offset + 1] ?? 0;
	const blue = data[offset + 2] ?? 0;

	return (
		red >= markerRedMinimum &&
		green >= markerGreenMinimum &&
		blue <= markerBlueMaximum &&
		red - blue >= markerRedBlueDelta &&
		green - blue >= markerGreenBlueDelta
	);
}

function createCandidate(
	line: RecognizedTextLine,
	match: CandidateMatch,
	imageData: ImageData
): InstallationPhotoCandidate {
	const markerScore = Math.round(getMarkerPixelRatio(imageData, line.boundingBox) * 100);

	return {
		id: crypto.randomUUID(),
		groupId: match.item.groupId,
		groupName: match.item.groupName,
		kksItemId: match.item.kksItemId,
		kksName: match.item.kksName,
		rawText: line.text.trim(),
		normalizedText: match.token,
		confidence: Math.round(line.confidence),
		markerScore,
		boundingBox: line.boundingBox,
		selected: line.confidence >= highConfidenceThreshold || markerScore >= selectedMarkerScoreThreshold,
	};
}

function chooseBestCandidate(
	current: InstallationPhotoCandidate | undefined,
	next: InstallationPhotoCandidate
) {
	if (!current) return next;
	if (next.markerScore !== current.markerScore)
		return next.markerScore > current.markerScore ? next : current;

	return next.confidence > current.confidence ? next : current;
}

export function createInstallationPhotoCandidates(
	lines: RecognizedTextLine[],
	knownItems: InstallationPhotoKnownItem[],
	imageData: ImageData
) {
	const knownByName = createKnownItemIndex(knownItems);
	const bestByItemId = new Map<string, InstallationPhotoCandidate>();

	for (const line of lines) {
		for (const match of findLineMatches(line, knownByName)) {
			const nextCandidate = createCandidate(line, match, imageData);
			const currentCandidate = bestByItemId.get(match.item.kksItemId);

			bestByItemId.set(match.item.kksItemId, chooseBestCandidate(currentCandidate, nextCandidate));
		}
	}

	return [...bestByItemId.values()].sort((left, right) => left.kksName.localeCompare(right.kksName, "ru"));
}
