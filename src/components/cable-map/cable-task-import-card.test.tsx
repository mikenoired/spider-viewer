import { afterEach, describe, expect, it, mock } from "bun:test";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const analyzeCableTaskList = mock();
const attach = mock(async (_request: { data: FormData }) => ({ id: "event-id", reused: false }));
mock.module("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate: mock() }) }));
mock.module("@/lib/cable-map/functions", () => ({
	analyzeCableTaskList,
	attachKanbanFile: attach,
	downloadKanbanFile: mock(),
	uploadCableTaskList: mock(),
	seedKanbanDemo: mock(),
}));

const { CableTaskImportCard } = await import("./cable-task-import-card");

const { TaskAttachments } = await import("./task-attachments");
afterEach(() => {
	cleanup();
	mock.clearAllMocks();
});

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

it("uploads into the current mounting card without calling a list-import action", async () => {
	const refresh = mock(async () => undefined);
	render(
		<TaskAttachments
			listId="list-id"
			status="in_progress"
			session={{ id: "user-id", role: "user", login: "tester", department: "skm" }}
			attachments={[]}
			onChange={refresh}
		/>
	);
	fireEvent.change(screen.getByLabelText("Прикрепить PDF или скан"), {
		target: { files: [new File(["%PDF-1.7"], "task.pdf")] },
	});
	fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
	await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
	const request = attach.mock.calls[0]![0] as unknown as { data: FormData };
	expect(request.data.get("listId")).toBe("list-id");
	expect((request.data.get("file") as File).name).toBe("task.pdf");
});

it("hides upload in another column while keeping existing attachments visible", () => {
	render(
		<TaskAttachments
			listId="list-id"
			status="adjustment"
			session={{ id: "user-id", role: "super-admin", login: "tester", department: "skm" }}
			attachments={[{ id: "attachment", fileName: "scan.pdf", sizeBytes: 512 }]}
			onChange={async () => undefined}
		/>
	);
	expect(screen.queryByLabelText("Прикрепить PDF или скан")).toBeNull();
	expect(screen.getByRole("button", { name: "scan.pdf · 1 КБ" })).toBeTruthy();
	expect(attach).not.toHaveBeenCalled();
});
