import { describe, expect, it } from "vitest";

import {
	createInstallationPhotoCandidates,
	normalizeInstallationPhotoText,
	type RecognizedTextLine,
} from "./recognition";
import type { InstallationPhotoKnownItem } from "./shared";

function createImageData() {
	const imageData = {
		width: 12,
		height: 6,
		data: new Uint8ClampedArray(12 * 6 * 4),
	} as ImageData;

	for (let offset = 0; offset < imageData.data.length; offset += 4) {
		imageData.data[offset] = 255;
		imageData.data[offset + 1] = 240;
		imageData.data[offset + 2] = 80;
		imageData.data[offset + 3] = 255;
	}

	return imageData;
}

function createKnownItem(): InstallationPhotoKnownItem {
	return {
		snapshotId: "snapshot-1",
		groupId: "group-1",
		groupName: "1HV44",
		kksItemId: "item-1",
		kksName: "1HV44K190",
		isDone: false,
	};
}

function createLine(text: string): RecognizedTextLine {
	return {
		text,
		confidence: 82,
		boundingBox: {
			left: 0,
			top: 0,
			width: 12,
			height: 6,
		},
	};
}

describe("installation photo recognition", () => {
	it("normalizes cyrillic lookalikes for KKS matching", () => {
		expect(normalizeInstallationPhotoText("1НV44К190")).toBe("1HV44K19O");
	});

	it("creates selected candidates for known KKS tokens", () => {
		const [candidate] = createInstallationPhotoCandidates(
			[createLine("готово 1НV44К190")],
			[createKnownItem()],
			createImageData()
		);

		expect(candidate?.kksName).toBe("1HV44K190");
		expect(candidate?.selected).toBe(true);
		expect(candidate?.markerScore).toBe(100);
	});
});
