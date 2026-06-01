import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";
import * as Xlsx from "xlsx";

import { __installationImportTestUtils } from "./import.server";

function createWorkbookBuffer(rows: string[][], sheetName = "Кабеля для ступенчатого пуска н") {
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

function createUpload(buffer: Buffer) {
	return {
		buffer,
		file: new File([new Uint8Array(buffer)], "installation.xlsx", {
			type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		}),
		fileType: "xlsx" as const,
	};
}

describe("installation workbook import", () => {
	it("collects mechanism and cable KKS from priority cards", () => {
		const workbook = __installationImportTestUtils.readWorkbook(
			createUpload(
				createWorkbookBuffer([
					["АРМАТУРА"],
					["№ п/п", "KKS", "Кабель", "Кабель"],
					["", "", "Гермо-проходка", "РТЗО"],
					["1", "1TQ12S02", "1TQ12S02K334A", "1TQ12S02K334"],
				])
			)
		);
		const rows = __installationImportTestUtils.parseInstallationRows(
			"installation.xlsx",
			workbook,
			new Map()
		);

		expect(rows.map((row) => row.kksName)).toEqual(["1ТQ12S02", "1ТQ12S02К334А", "1ТQ12S02К334"]);
		expect(rows.map((row) => row.itemType)).toEqual(["mechanism", "cable", "cable"]);
	});

	it("marks cable KKS as done from the cable base", () => {
		const priorityWorkbook = __installationImportTestUtils.readWorkbook(
			createUpload(
				createWorkbookBuffer([
					["АРМАТУРА"],
					["№ п/п", "KKS", "Кабель"],
					["", "", "Гермо-проходка"],
					["1", "1TQ12S02", "1TQ12S02K334"],
				])
			)
		);
		const baseWorkbook = __installationImportTestUtils.readWorkbook(
			createUpload(
				createWorkbookBuffer(
					[
						["Монтажная марка", "Проложено"],
						["1TQ12S02K334", "24"],
					],
					"База"
				)
			)
		);
		const statusByKks = __installationImportTestUtils.buildCableBaseIndex([baseWorkbook]);
		const rows = __installationImportTestUtils.parseInstallationRows(
			"installation.xlsx",
			priorityWorkbook,
			statusByKks
		);

		expect(rows.find((row) => row.kksName === "1ТQ12S02К334")?.isDone).toBe(true);
		expect(rows.find((row) => row.kksName === "1ТQ12S02К334")?.matchedInCableBase).toBe(true);
		expect(rows.find((row) => row.kksName === "1ТQ12S02")?.isDone).toBe(false);
	});

	it("keeps the legacy group KKS format available", () => {
		const workbook = __installationImportTestUtils.readWorkbook(
			createUpload(
				createWorkbookBuffer(
					[
						["Группа KKS", "KKS", "Готово"],
						["ИК", "1RY11T01K500", "да"],
					],
					"Лист1"
				)
			)
		);
		const rows = __installationImportTestUtils.parseInstallationRows("legacy.xlsx", workbook, new Map());

		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			groupName: "ИК",
			kksName: "1RY11T01K500",
			isDone: true,
		});
	});
});
