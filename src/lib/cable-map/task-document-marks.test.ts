import { expect, it } from "bun:test";

import { applyMarginPluses, findMarginPluses } from "./task-document-marks";
import { documentCableRowSchema } from "./task-documents";

it("finds a margin cross, ignores interior crosses and solid boxes, and binds only one row", () => {
	const width = 1000,
		height = 500,
		data = new Uint8ClampedArray(width * height * 4).fill(255);
	function pixel(x: number, y: number) {
		const i = (y * width + x) * 4;
		data[i] = data[i + 1] = data[i + 2] = 0;
	}
	function plus(x: number, y: number) {
		for (let d = -10; d <= 10; d++)
			for (let t = -1; t <= 1; t++) {
				pixel(x + d, y + t);
				pixel(x + t, y + d);
			}
	}
	plus(25, 100);
	plus(500, 200);
	for (let x = 15; x < 35; x++) for (let y = 300; y < 320; y++) pixel(x, y);
	const marks = findMarginPluses({ width, height, data });
	expect(marks).toEqual([{ center: 100, height: 21 }]);
	const rows = ["1HX98K176", "1HX98K177"].map((cableLabel) =>
		documentCableRowSchema.parse({ page: 1, cableLabel })
	);
	const lines = rows.map((row, i) => ({
		text: row.cableLabel,
		confidence: 90,
		boundingBox: { left: 100, top: 90 + i * 60, width: 150, height: 20 },
	}));
	applyMarginPluses(rows, lines, marks);
	expect(rows.map((row) => row.completed)).toEqual([true, false]);
});
it("does not guess completion when two cable rows share the same vertical anchor", () => {
	const rows = ["1HX98K176", "1HX98K177"].map((cableLabel) =>
		documentCableRowSchema.parse({ page: 1, cableLabel })
	);
	const lines = rows.map((row) => ({
		text: row.cableLabel,
		confidence: 90,
		boundingBox: { left: 100, top: 90, width: 150, height: 20 },
	}));
	applyMarginPluses(rows, lines, [{ center: 100, height: 21 }]);
	expect(rows.every((row) => !row.completed)).toBe(true);
});
