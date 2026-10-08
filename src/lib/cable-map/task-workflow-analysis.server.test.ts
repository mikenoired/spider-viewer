import { beforeEach, describe, expect, it, mock } from "bun:test";

import * as Xlsx from "xlsx";

import type * as CableImport from "./import.server";

const mocks = { from: mock(), select: mock(), ensureCanonicalCableBase: mock() };
mock.module("@/lib/db", () => ({ getDb: () => ({ select: mocks.select }) }));
const importServer = await import("./import.server");
mock.module("./import.server", () => ({
	...(importServer as typeof CableImport),
	ensureCanonicalCableBase: mocks.ensureCanonicalCableBase,
}));

const { getCableExternalKey } = await import("./import.server");
const { analyzeCableTaskListFromFormData } = await import("./task-workflow.server");

beforeEach(() => {
	mock.clearAllMocks();
	mocks.select.mockReturnValue({ from: mocks.from });
});

describe("task workbook analysis", () => {
	it("returns matched links with warnings and unsupported sheet notifications to the importer", async () => {
		const cable = {
			id: "cable-1",
			cableLabel: "1BV13-200 КВВГЭнг(А)-FRLS 4х1,5",
			cableMarking: "1BV13-200",
			cableJournal: "А-218495",
			cableNumber: "1.0001",
			fromRoom: "АЭ607/1",
			toRoom: "АЭ052",
		};
		mocks.from.mockResolvedValue([{ ...cable, externalKey: getCableExternalKey(cable) }]);
		const workbook = Xlsx.utils.book_new();
		Xlsx.utils.book_append_sheet(
			workbook,
			Xlsx.utils.aoa_to_sheet([
				["Кабель", "Журнал", "Номер", "Откуда", "Куда"],
				["1bv13-200", "Другой журнал", "1.0001", "АЭ607/1", "АЭ052"],
			]),
			"ЭЦ"
		);
		Xlsx.utils.book_append_sheet(
			workbook,
			Xlsx.utils.aoa_to_sheet([
				["KKS", "Кабель", "Кабель"],
				["KKS-1", "CABLE-1", "CABLE-2"],
			]),
			"Пуск"
		);
		const formData = new FormData();
		formData.set(
			"file",
			new File([Xlsx.write(workbook, { type: "buffer", bookType: "xlsx" })], "priority.xlsx", {
				type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			})
		);
		const result = await analyzeCableTaskListFromFormData(formData, {
			id: "user-1",
			login: "tester",
			role: "user",
			department: "tai",
		});
		expect(result).toMatchObject({
			totalCount: 1,
			matchedCount: 1,
			missing: [],
			ambiguous: [],
			warnings: [
				{
					cableId: "cable-1",
					cableLabel: cable.cableLabel,
					differences: [{ field: "Журнал", source: "Другой журнал", matched: "А-218495" }],
				},
			],
			skippedSheets: [{ sheetName: "Пуск", cablePositionCount: 2 }],
		});
		expect(mocks.ensureCanonicalCableBase).toHaveBeenCalledTimes(1);
		expect(mocks.select.mock.calls[0][0]).toHaveProperty("cableMarking");
		expect(mocks.select.mock.calls[0][0]).toHaveProperty("fromRoom");
	});
});
