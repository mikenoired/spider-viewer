import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";
import * as Xlsx from "xlsx";

import {
	__test__normalizePriorityRoomName,
	__test__parsePriorityRoomRows,
} from "./priority-room-lists.server";

function createWorkbookBuffer(rows: string[][]) {
	const workbook = Xlsx.utils.book_new();
	const sheet = Xlsx.utils.aoa_to_sheet(rows);

	Xlsx.utils.book_append_sheet(workbook, sheet, "Приоритет");

	return Buffer.from(
		Xlsx.write(workbook, {
			type: "buffer",
			bookType: "xlsx",
		})
	);
}

describe("priority room lists", () => {
	it("normalizes visual latin characters in room names", () => {
		expect(__test__normalizePriorityRoomName("A 101")).toBe("а 101");
	});

	it("parses the first non-empty cell of each row and removes duplicates", () => {
		const buffer = createWorkbookBuffer([
			["Помещение"],
			["A101"],
			["", "B202"],
			["А101"],
		]);

		const rooms = __test__parsePriorityRoomRows("priority.xlsx", buffer);

		expect(rooms).toEqual([
			{
				roomName: "А101",
				normalizedRoomName: "а101",
			},
			{
				roomName: "В202",
				normalizedRoomName: "в202",
			},
		]);
	});
});
