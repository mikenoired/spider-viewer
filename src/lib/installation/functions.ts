import { createServerFn } from "@tanstack/react-start";

import { requireSession } from "@/lib/auth/guards";
import { canEditInstallation } from "@/lib/auth/shared";

import {
	applyInstallationPendingGroupSchema,
	saveInstallationKksSchema,
	submitInstallationOfflineChangesSchema,
} from "./shared";

async function requireInstallationEditor() {
	const session = await requireSession();

	if (!canEditInstallation(session.role)) {
		throw new Error("Недостаточно прав для редактирования монтажа.");
	}

	return session;
}

export const getInstallationBoardData = createServerFn({ method: "GET" }).handler(async () => {
	const { getActiveInstallationBoardData } = await import("./queries.server");
	return getActiveInstallationBoardData();
});

export const uploadInstallationWorkbook = createServerFn({ method: "POST" })
	.inputValidator((input: FormData) => input)
	.handler(async ({ data }) => {
		const session = await requireInstallationEditor();
		const { importWorkbookFromFormData } = await import("../cable-map/import.server");

		return importWorkbookFromFormData(data, session, {
			snapshotKind: "installation",
		});
	});

export const uploadInstallationProgressWorkbooks = createServerFn({ method: "POST" })
	.inputValidator((input: FormData) => input)
	.handler(async ({ data }) => {
		const session = await requireInstallationEditor();
		const { importInstallationProgressFromFormData } = await import("./progress-import.server");

		return importInstallationProgressFromFormData(data, session);
	});

export const saveInstallationKks = createServerFn({ method: "POST" })
	.inputValidator(saveInstallationKksSchema)
	.handler(async ({ data }) => {
		const session = await requireInstallationEditor();
		const { saveInstallationKksState } = await import("./mutations.server");

		return saveInstallationKksState(data, session);
	});

export const submitInstallationOfflineChanges = createServerFn({ method: "POST" })
	.inputValidator(submitInstallationOfflineChangesSchema)
	.handler(async ({ data }) => {
		const session = await requireInstallationEditor();
		const { submitInstallationOfflineChanges } = await import("./mutations.server");

		return submitInstallationOfflineChanges(data, session);
	});

export const applyInstallationPendingGroup = createServerFn({ method: "POST" })
	.inputValidator(applyInstallationPendingGroupSchema)
	.handler(async ({ data }) => {
		const session = await requireInstallationEditor();
		const { applyInstallationPendingGroup } = await import("./mutations.server");

		return applyInstallationPendingGroup(data, session);
	});
