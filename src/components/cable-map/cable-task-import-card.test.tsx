import { afterEach, describe, expect, it, mock } from "bun:test";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const analyzeCableTaskList = mock();
mock.module("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate: mock() }) }));
mock.module("@/lib/cable-map/functions", () => ({
	analyzeCableTaskList,
	uploadCableTaskList: mock(),
	seedKanbanDemo: mock(),
}));

const { CableTaskImportCard } = await import("./cable-task-import-card");

afterEach(cleanup);

describe("task import warnings", () => {
	it("shows the selected cable, differences and skipped sheets while allowing import", async () => {
		analyzeCableTaskList.mockResolvedValue({
			fileName: "priority.xlsx",
			totalCount: 1,
			matchedCount: 1,
			missing: [],
			ambiguous: [],
			baseCount: 10,
			allowedStages: ["formed"],
			warnings: [
				{
					sheetName: "ЭЦ",
					rowIndex: 3,
					cableId: "cable-1",
					cableLabel: "1BV13-200",
					cableJournal: "А-218495",
					cableNumber: "1.0001",
					differences: [{ field: "Журнал", source: "Другой журнал", matched: "А-218495" }],
				},
			],
			skippedSheets: [{ sheetName: "Пуск", cablePositionCount: 2 }],
		});
		render(
			<CableTaskImportCard session={{ id: "user-1", login: "tester", role: "user", department: "tai" }} />
		);
		fireEvent.change(screen.getByLabelText("Список кабелей (как в кабельном журнале)"), {
			target: { files: [new File(["workbook"], "priority.xlsx")] },
		});
		fireEvent.click(screen.getByRole("button", { name: "Анализировать файл" }));
		await screen.findByText(/ЭЦ, строка 3: связь с кабелем 1BV13-200/);
		expect(screen.getByText(/Журнал: в файле «Другой журнал», в базе «А-218495»/)).toBeTruthy();
		expect(screen.getByText(/Пуск: заполненных позиций в колонках кабеля — 2/)).toBeTruthy();
		expect((screen.getByRole("button", { name: "Подтвердить импорт" }) as HTMLButtonElement).disabled).toBe(
			false
		);
	});
});
