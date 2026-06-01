import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";
import * as Xlsx from "xlsx";

import { __installationProgressImportTestUtils } from "./progress-import.server";

function createWorkbookBuffer(rows: string[][], sheetName = "Арматура") {
	const workbook = Xlsx.utils.book_new();
	const sheet = Xlsx.utils.aoa_to_sheet(rows);

	Xlsx.utils.book_append_sheet(workbook, sheet, sheetName);

	return Buffer.from(
		Xlsx.write(workbook, {
			type: "buffer",
			bookType: "xlsx",
		})
	);
}

function createRow(values: Record<number, string>) {
	const row = Array.from({ length: 27 }, () => "");

	for (const [column, value] of Object.entries(values)) {
		row[Number(column)] = value;
	}

	return row;
}

describe("installation progress import", () => {
	it("uses explicit completion cells when journal rows contain completion marks", () => {
		const tokens = __installationProgressImportTestUtils.parseCompletedCableTokens(
			"ready.xlsx",
			createWorkbookBuffer([
				createRow({}),
				createRow({}),
				createRow({ 13: "1TQ12S02K334A" }),
				createRow({ 13: "1TQ12S03K334A", 14: "12.05.2026" }),
			])
		);

		expect([...tokens]).toEqual(["1ТQ12S03К334А"]);
	});

	it("keeps site-export completion lists usable when signature cells are empty", () => {
		const tokens = __installationProgressImportTestUtils.parseCompletedCableTokens(
			"ready.xlsx",
			createWorkbookBuffer([
				createRow({}),
				createRow({}),
				createRow({ 13: "1TQ12S02K334A" }),
				createRow({ 13: "1ТQ12S03К334А" }),
			])
		);

		expect([...tokens]).toEqual(["1ТQ12S02К334А", "1ТQ12S03К334А"]);
	});
});
