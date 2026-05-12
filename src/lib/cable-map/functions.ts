import { createServerFn } from "@tanstack/react-start";

import { requireRole } from "@/lib/auth/guards";
import { canEditProgress, canViewAudit } from "@/lib/auth/shared";

import {
	createManualRoomSchema,
	dateRangeSchema,
	deleteManualRoomSchema,
	exportBackdatedSchema,
	exportDailyHistorySchema,
	exportHistorySchema,
	saveCableProgressSchema,
} from "./shared";

export const getDashboardData = createServerFn({ method: "GET" }).handler(async () => {
	const { getActiveDashboardData } = await import("./queries.server");
	return getActiveDashboardData();
});

export const uploadWorkbook = createServerFn({ method: "POST" })
	.inputValidator((input: FormData) => input)
	.handler(async ({ data }) => {
		const session = await requireRole(["super-admin"]);
		const { importWorkbookFromFormData } = await import("./import.server");
		return importWorkbookFromFormData(data, session);
	});

export const saveCableProgress = createServerFn({ method: "POST" })
	.inputValidator(saveCableProgressSchema)
	.handler(async ({ data }) => {
		const session = await requireRole(["super-admin"]);

		if (!canEditProgress(session.role)) {
			throw new Error("Недостаточно прав для изменения прогресса.");
		}

		const { saveCableProgressChanges } = await import("./history.server");
		return saveCableProgressChanges(data, session);
	});

export const createManualRoom = createServerFn({ method: "POST" })
	.inputValidator(createManualRoomSchema)
	.handler(async ({ data }) => {
		const session = await requireRole(["super-admin"]);
		const { createManualGroupRoom } = await import("./manual-rooms.server");
		return createManualGroupRoom(data, session);
	});

export const deleteManualRoom = createServerFn({ method: "POST" })
	.inputValidator(deleteManualRoomSchema)
	.handler(async ({ data }) => {
		const session = await requireRole(["super-admin"]);
		const { deleteManualGroupRoom } = await import("./manual-rooms.server");
		return deleteManualGroupRoom(data, session);
	});

export const getHistory = createServerFn({ method: "GET" })
	.inputValidator(dateRangeSchema.optional())
	.handler(async ({ data }) => {
		const session = await requireRole(["super-admin"]);

		if (!canViewAudit(session.role)) {
			throw new Error("Недостаточно прав для просмотра истории.");
		}

		const { getHistoryEntries } = await import("./queries.server");
		return getHistoryEntries(data);
	});

export const getBackdatedHistory = createServerFn({ method: "GET" })
	.inputValidator(dateRangeSchema.optional())
	.handler(async ({ data }) => {
		const session = await requireRole(["super-admin"]);

		if (!canViewAudit(session.role)) {
			throw new Error("Недостаточно прав для просмотра истории.");
		}

		const { getHistoryEntries } = await import("./queries.server");
		return getHistoryEntries(data, {
			backdatedOnly: true,
		});
	});

export const downloadHistoryDocx = createServerFn({ method: "POST" })
	.inputValidator(exportHistorySchema)
	.handler(async ({ data }) => {
		const session = await requireRole(["super-admin"]);

		if (!canViewAudit(session.role)) {
			throw new Error("Недостаточно прав для экспорта отчёта.");
		}

		const { createHistoryDocx } = await import("./history.server");
		const buffer = await createHistoryDocx(data);
		const fileName = data.fileName?.trim() || "history-report.docx";

		return new Response(new Uint8Array(buffer), {
			headers: {
				"Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				"Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
			},
		});
	});

export const downloadBackdatedDocx = createServerFn({ method: "POST" })
	.inputValidator(exportBackdatedSchema)
	.handler(async ({ data }) => {
		const session = await requireRole(["super-admin"]);

		if (!canViewAudit(session.role)) {
			throw new Error("Недостаточно прав для экспорта отчёта.");
		}

		const { createBackdatedDocx } = await import("./history.server");
		const buffer = await createBackdatedDocx(data);
		const fileName = data.fileName?.trim() || "backdated-report.docx";

		return new Response(new Uint8Array(buffer), {
			headers: {
				"Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				"Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
			},
		});
	});

export const downloadDailyHistoryDocx = createServerFn({ method: "POST" })
	.inputValidator(exportDailyHistorySchema)
	.handler(async ({ data }) => {
		const session = await requireRole(["super-admin"]);

		if (!canViewAudit(session.role)) {
			throw new Error("Недостаточно прав для экспорта отчёта.");
		}

		const { createDailyHistoryDocx } = await import("./history.server");
		const { buildDailyHistoryReportFileName } = await import("./report-utils");
		const buffer = await createDailyHistoryDocx(data.level);
		const fileName = data.fileName?.trim() || buildDailyHistoryReportFileName(data.level);

		return new Response(new Uint8Array(buffer), {
			headers: {
				"Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				"Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
			},
		});
	});
