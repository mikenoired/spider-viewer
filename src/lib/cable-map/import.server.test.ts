import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
	ensureUploadFile,
	hasExpectedWorkbookSignature,
	parseWorkbookRows,
} from "./import.server";

const workbookColumnIndexes = {
	cableLabel: 0,
	fromRoom: 7,
	toRoom: 10,
	threadLength: 11,
	threadCount: 12,
	totalLength: 13,
	level: 14,
	fromZone: 15,
	toZone: 16,
	shaft1: 20,
	route: 31,
} as const;

function createWorkbookBuffer(rows: string[][], sheetName = "Общ") {
	return createWorkbookBufferForType(rows, "xlsx", sheetName);
}

function createWorkbookBufferForType(
	rows: string[][],
	bookType: "ods" | "xlsx",
	sheetName = "Общ",
) {
	const workbook = XLSX.utils.book_new();
	const sheet = XLSX.utils.aoa_to_sheet(rows);

	XLSX.utils.book_append_sheet(workbook, sheet, sheetName);

	return Buffer.from(
		XLSX.write(workbook, {
			type: "buffer",
			bookType,
		}),
	);
}

function createWorkbookRows() {
	const headerRow = Array.from({ length: 32 }, (_, index) => `column-${index}`);
	headerRow[workbookColumnIndexes.shaft1] = "Ш_1";

	const dataRow = Array.from({ length: 32 }, () => "");
	dataRow[workbookColumnIndexes.cableLabel] = "КВВГ 4x2,5";
	dataRow[workbookColumnIndexes.fromRoom] = "A101";
	dataRow[workbookColumnIndexes.toRoom] = "B202";
	dataRow[workbookColumnIndexes.threadLength] = "12,5";
	dataRow[workbookColumnIndexes.threadCount] = "4";
	dataRow[workbookColumnIndexes.totalLength] = "50";
	dataRow[workbookColumnIndexes.level] = "3,6";
	dataRow[workbookColumnIndexes.fromZone] = "ГЗ";
	dataRow[workbookColumnIndexes.toZone] = "ЧЗ";
	dataRow[workbookColumnIndexes.shaft1] = "есть";
	dataRow[workbookColumnIndexes.route] = "маршрут";

	return [headerRow, dataRow];
}

describe("workbook import validation", () => {
	it("accepts a valid workbook upload", async () => {
		const buffer = createWorkbookBuffer(createWorkbookRows());
		const formData = new FormData();

		formData.set(
			"file",
			new File([buffer], "report.xlsx", {
				type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			}),
		);

		const result = await ensureUploadFile(formData);

		expect(result.fileType).toBe("xlsx");
		expect(hasExpectedWorkbookSignature(result.fileType, result.buffer)).toBe(
			true,
		);
	});

	it("accepts a valid ods upload", async () => {
		const buffer = createWorkbookBufferForType(createWorkbookRows(), "ods");
		const formData = new FormData();

		formData.set(
			"file",
			new File([buffer], "report.ods", {
				type: "application/vnd.oasis.opendocument.spreadsheet",
			}),
		);

		const result = await ensureUploadFile(formData);

		expect(result.fileType).toBe("ods");
		expect(hasExpectedWorkbookSignature(result.fileType, result.buffer)).toBe(
			true,
		);
	});

	it("rejects an upload with an unexpected mime type", async () => {
		const formData = new FormData();

		formData.set(
			"file",
			new File(["PK"], "report.xlsx", {
				type: "text/plain",
			}),
		);

		await expect(ensureUploadFile(formData)).rejects.toThrow(/MIME-тип/);
	});

	it("rejects a file that does not match workbook signature", async () => {
		const formData = new FormData();

		formData.set(
			"file",
			new File(["not-a-workbook"], "report.xlsx", {
				type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			}),
		);

		await expect(ensureUploadFile(formData)).rejects.toThrow(/не похож/);
	});

	it("parses a valid workbook row", () => {
		const rows = parseWorkbookRows(
			"report.xlsx",
			createWorkbookBuffer(createWorkbookRows()),
		);

		expect(rows).toHaveLength(1);
		expect(rows[0]?.fromRoom).toBe("А101");
		expect(rows[0]?.threadCount).toBe(4);
		expect(rows[0]?.graphSide).toBe("dirty");
	});

	it("parses a valid ods row", () => {
		const rows = parseWorkbookRows(
			"report.ods",
			createWorkbookBufferForType(createWorkbookRows(), "ods"),
		);

		expect(rows).toHaveLength(1);
		expect(rows[0]?.fromRoom).toBe("А101");
		expect(rows[0]?.threadCount).toBe(4);
		expect(rows[0]?.graphSubzone).toBe("dirty");
	});

	it("rejects a workbook without the expected sheet", () => {
		const buffer = createWorkbookBuffer(createWorkbookRows(), "Data");

		expect(() => parseWorkbookRows("report.xlsx", buffer)).toThrow(
			/лист "Общ"/,
		);
	});
});
