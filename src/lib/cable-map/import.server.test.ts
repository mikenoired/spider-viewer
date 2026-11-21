import { describe, expect, it } from "bun:test";
import { Buffer } from "node:buffer";

import * as Xlsx from "xlsx";

import {
	createCanonicalCableKeyResolver,
	ensureUploadFile,
	getCableExternalKey,
	getCanonicalCableAttributes,
	hasExpectedWorkbookSignature,
	normalizeCableIdentityPart,
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

function createWorkbookBufferForType(rows: string[][], bookType: "ods" | "xlsx", sheetName = "Общ") {
	const workbook = Xlsx.utils.book_new();
	const sheet = Xlsx.utils.aoa_to_sheet(rows);

	Xlsx.utils.book_append_sheet(workbook, sheet, sheetName);

	return Buffer.from(
		Xlsx.write(workbook, {
			type: "buffer",
			bookType,
		})
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
	it("builds a stable canonical cable key from journal and number", () => {
		expect(
			getCableExternalKey({
				cableLabel: "КВВГ 4x2,5",
				cableJournal: "Ж-12",
				cableNumber: "0042",
				fromRoom: "А101",
				toRoom: "Б202",
			})
		).toBe("journal:Ж-12|number:0042");
	});

	it("falls back to cable attributes when journal data is absent", () => {
		expect(
			getCableExternalKey({
				cableLabel: "КВВГ 4x2,5",
				cableJournal: "",
				cableNumber: "",
				fromRoom: "А101",
				toRoom: "Б202",
			})
		).toBe("КВВГ 4Х2,5|А101|Б202");
	});

	it("normalizes visually equivalent latin characters in cable identities", () => {
		expect(normalizeCableIdentityPart("AЭ 408/1")).toBe("АЭ 408/1");
		expect(normalizeCableIdentityPart("1HV116k1301")).toBe("1НV116К1301");
	});

	it("normalizes lowercase B the same way as uppercase B", () => {
		expect(normalizeCableIdentityPart("1bv13-200")).toBe(normalizeCableIdentityPart("1BV13-200"));
		expect(normalizeCableIdentityPart("abcekmhoptxy")).toBe(normalizeCableIdentityPart("ABCEKMHOPTXY"));
	});

	it("reuses a stored key after normalization changes instead of creating a second cable", () => {
		const cable = {
			externalKey: "journal:JЬ-1|number:0042",
			cableLabel: "1bv13-200",
			cableJournal: "jb-1",
			cableNumber: "0042",
			fromRoom: "А101",
			toRoom: "Б202",
		};
		const resolve = createCanonicalCableKeyResolver([cable]);
		expect(resolve({ ...cable, cableJournal: "JB-1", cableLabel: "1BV13-200" })).toBe(cable.externalKey);
	});

	it("rejects ambiguous historical keys instead of choosing an arbitrary existing cable", () => {
		const cable = {
			cableLabel: "1bv13-200",
			cableJournal: "jb-1",
			cableNumber: "0042",
			fromRoom: "А101",
			toRoom: "Б202",
		};
		const resolve = createCanonicalCableKeyResolver([
			{ ...cable, externalKey: "legacy-1" },
			{ ...cable, externalKey: "legacy-2" },
		]);
		expect(() => resolve(cable)).toThrow(/проверить дубли/);
	});

	it("stores installation marking and physical rooms independently of descriptive label and equipment groups", () => {
		const rawRow = Array.from({ length: 32 }, () => "");
		rawRow[7] = "1BV13-200";
		rawRow[13] = "АЭ607/1";
		rawRow[24] = "АЭ052";
		expect(
			getCanonicalCableAttributes(
				{ cableLabel: "1BV13-200 КВВГЭнг(А)-FRLS 4х1,5", fromRoom: "KKS-TO", toRoom: "KKS-FROM", rawRow },
				"installation"
			)
		).toEqual({ cableMarking: "1BV13-200", fromRoom: "АЭ607/1", toRoom: "АЭ052" });
	});

	it("preserves demolition marking and room attributes", () => {
		expect(
			getCanonicalCableAttributes(
				{ cableLabel: "1BV13-200", fromRoom: "АЭ607/1", toRoom: "АЭ052", rawRow: [] },
				"demolition"
			)
		).toEqual({ cableMarking: "1BV13-200", fromRoom: "АЭ607/1", toRoom: "АЭ052" });
	});

	it("accepts a valid workbook upload", async () => {
		const buffer = createWorkbookBuffer(createWorkbookRows());
		const formData = new FormData();

		formData.set(
			"file",
			new File([buffer], "report.xlsx", {
				type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			})
		);

		const result = await ensureUploadFile(formData);

		expect(result.fileType).toBe("xlsx");
		expect(hasExpectedWorkbookSignature(result.fileType, result.buffer)).toBe(true);
	});

	it("accepts a valid ods upload", async () => {
		const buffer = createWorkbookBufferForType(createWorkbookRows(), "ods");
		const formData = new FormData();

		formData.set(
			"file",
			new File([buffer], "report.ods", {
				type: "application/vnd.oasis.opendocument.spreadsheet",
			})
		);

		const result = await ensureUploadFile(formData);

		expect(result.fileType).toBe("ods");
		expect(hasExpectedWorkbookSignature(result.fileType, result.buffer)).toBe(true);
	});

	it("rejects an upload with an unexpected mime type", async () => {
		const formData = new FormData();

		formData.set(
			"file",
			new File(["PK"], "report.xlsx", {
				type: "text/plain",
			})
		);

		await expect(ensureUploadFile(formData)).rejects.toThrow(/MIME-тип/);
	});

	it("rejects a file that does not match workbook signature", async () => {
		const formData = new FormData();

		formData.set(
			"file",
			new File(["not-a-workbook"], "report.xlsx", {
				type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			})
		);

		await expect(ensureUploadFile(formData)).rejects.toThrow(/не похож/);
	});

	it("parses a valid workbook row", () => {
		const rows = parseWorkbookRows("report.xlsx", createWorkbookBuffer(createWorkbookRows()));

		expect(rows).toHaveLength(1);
		expect(rows[0]?.fromRoom).toBe("А101");
		expect(rows[0]?.threadCount).toBe(4);
		expect(rows[0]?.graphSide).toBe("dirty");
	});

	it("imports the PSE base into clean zones without merging repeated journal numbers", () => {
		const headers = [
			"Договор",
			"Проект",
			"Наименование",
			"№ кабеля",
			"Марка кабеля\r\n(монтажная)",
			"Марка кабеля\r\n(заводская)",
			"Сечение",
			"Откуда (оборудование)",
			"Откуда (помещение)",
			"X начало",
			"Y начало",
			"Z начало",
			"Куда (оборудование)",
			"Куда (помещение)",
			"X конец",
			"Y конец",
			"Z конец",
			"Длина проектная, м",
			"Трассировка",
		];
		const data = [
			"Договор",
			"П-1",
			"Журнал",
			"3.0001",
			"1EM01-01",
			"ВВГ",
			"5*150",
			"Источник",
			"A101",
			"0",
			"0",
			"-3,6",
			"Приемник",
			"A102",
			"0",
			"0",
			"0",
			"12,5",
			"3125",
		];
		const second = [...data];
		second[4] = "1EM01-02";
		second[11] = "";
		second[8] = second[13] = "";
		const rows = parseWorkbookRows(
			"base.xlsx",
			createWorkbookBuffer([["", "", "Итого"], headers, data, second], "Лист1")
		);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			sourceRowIndex: 3,
			cableLabel: "1EM01-01",
			cableJournal: "Журнал",
			cableNumber: "3.0001",
			fromRoom: "А101",
			toRoom: "А102",
			fromEquipment: "Источник",
			level: "-4,2",
			levelOrder: -4.2,
			threadLength: 12.5,
			totalLength: 12.5,
			threadCount: 1,
			route: "3125",
			graphSide: "clean",
			graphSubzone: "clean",
			fromZone: "ЧЗ",
			toZone: "ЧЗ",
			farthestShaft: null,
		});
		expect(rows[1]?.level).toBe("Уровень не указан");
		expect(rows[1]?.fromRoom).toBe("Помещение не указано");
		expect(getCableExternalKey(rows[0]!)).not.toBe(getCableExternalKey(rows[1]!));
		const resolveKey = createCanonicalCableKeyResolver([]);
		expect(resolveKey(rows[0]!)).toBe(getCableExternalKey(rows[0]!));
	});

	it("assigns each PSE room by both endpoints and uses fixed floor boundaries", () => {
		const headers = [
			"Наименование",
			"№ кабеля",
			"Марка кабеля (монтажная)",
			"Откуда (оборудование)",
			"Откуда (помещение)",
			"Куда (помещение)",
			"Z начало",
			"Z конец",
			"Длина проектная, м",
			"Трассировка",
		];
		const examples = [
			["P100", "0", "R100", "41.4", "0"],
			["P101", "3,6", "R101", "0", "3,6"],
			["P102", "6.6", "R102", "3.6", "6,6"],
			["P103", "12", "R103", "3.6", "6,6"],
			["P104", "13.2", "R104", "3.6", "13,2"],
			["P105", "16.6", "R105", "3.6", "16,6"],
			["P106", "19,2", "R106", "3.6", "19,2"],
			["P107", "24", "R107", "3.6", "24"],
			["P108", "24.6", "R108", "3.6", "24,6"],
			["P109", "28.8", "R109", "3.6", "28,8"],
			["P110", "33.6", "R110", "3.6", "33,6"],
			["P111", "36.6", "R111", "3.6", "36,6"],
			["P112", "41.4", "R112", "3.6", "41,4"],
			["P113", "45.6", "R113", "3.6", "45,6"],
			["P114", "50.39", "R114", "3.6", "45,6"],
			["P115", "50.4", "R115", "3.6", "Уровень не указан"],
			["P116", "", "R116", "3.6", "Уровень не указан"],
			["P117", "-4.21", "R117", "3.6", "Уровень не указан"],
			["ГА101", "25.7", "R118", "3.6", "Гермообъём · 25,7"],
			["ГA102", "29.4", "R119", "3.6", "Гермообъём · 29,4"],
			["ГА103", "19.34", "R120", "3.6", "Гермообъём · 19,34"],
			["ГА104", "13.2", "R121", "3.6", "Гермообъём · 13,2"],
			["ГА105", "33.6", "R122", "3.6", "Гермообъём · 33,6"],
			["ГА106", "36.6", "R123", "3.6", "Гермообъём · 36,6"],
			["ГА107", "164", "R124", "3.6", "Уровень не указан"],
			["P101", "0", "R125", "0", "3,6"],
			["P101", "", "R126", "0", "3,6"],
			["R127", "0", "P101", "4.1", "0"],
			["P118", "10m", "R128", "0", "Уровень не указан"],
			["P119", "0", "R129", "0", "Уровень не указан"],
			["R130", "0", "P119", "3.6", "0"],
		];
		const sourceRows = examples.map(([from, startZ, to, endZ], i) => [
			"Журнал",
			String(i + 1),
			`cable-${i + 1}`,
			"Источник",
			from,
			to,
			startZ,
			endZ,
			"1",
			"",
		]);
		const read = (body: string[][]) =>
			parseWorkbookRows("base.xlsx", createWorkbookBuffer([headers, ...body], "Лист1")).map(
				(row) => row.level
			);
		const expected = examples.map((example) => example[4]);
		expect(read(sourceRows)).toEqual(expected);
		expect(read([...sourceRows].reverse())).toEqual([...expected].reverse());
	});

	it("parses a valid ods row", () => {
		const rows = parseWorkbookRows("report.ods", createWorkbookBufferForType(createWorkbookRows(), "ods"));

		expect(rows).toHaveLength(1);
		expect(rows[0]?.fromRoom).toBe("А101");
		expect(rows[0]?.threadCount).toBe(4);
		expect(rows[0]?.graphSubzone).toBe("dirty");
	});

	it("rejects a workbook without the expected sheet", () => {
		const buffer = createWorkbookBuffer(createWorkbookRows(), "Data");

		expect(() => parseWorkbookRows("report.xlsx", buffer)).toThrow(/лист "Общ"/);
	});
});
