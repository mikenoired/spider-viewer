import { createServerFn } from "@tanstack/react-start";
import { requireRole } from "@/lib/auth/guards";
import { canEditProgress, canViewAudit } from "@/lib/auth/shared";
import {
	dateRangeSchema,
	exportBackdatedSchema,
	saveRoomProgressSchema,
} from "./shared";

export const getDashboardData = createServerFn({ method: "GET" }).handler(
	async () => {
		const { getActiveDashboardData } = await import("./queries.server");
		return getActiveDashboardData();
	},
);

export const uploadWorkbook = createServerFn({ method: "POST" })
	.inputValidator((input: FormData) => input)
	.handler(async ({ data }) => {
		const session = await requireRole(["super-admin"]);
		const { importWorkbookFromFormData } = await import("./import.server");
		return importWorkbookFromFormData(data, session);
	});

export const saveRoomProgress = createServerFn({ method: "POST" })
	.inputValidator(saveRoomProgressSchema)
	.handler(async ({ data }) => {
		const session = await requireRole(["admin", "super-admin"]);

		if (!canEditProgress(session.role)) {
			throw new Error("Недостаточно прав для изменения прогресса.");
		}

		const { saveRoomProgressChanges } = await import("./history.server");
		return saveRoomProgressChanges(data, session);
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
		return getHistoryEntries(data, true);
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
				"Content-Type":
					"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				"Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
			},
		});
	});
