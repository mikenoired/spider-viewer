import * as z from "zod";

export const installationColumnIds = ["not_started", "in_progress", "done", "processing"] as const;
export const installationVisibleColumnIds = ["not_started", "in_progress", "done"] as const;
export const installationKksItemTypes = ["mechanism", "cable"] as const;

export type InstallationColumnId = (typeof installationColumnIds)[number];
export type InstallationVisibleColumnId = (typeof installationVisibleColumnIds)[number];
export type InstallationKksItemType = (typeof installationKksItemTypes)[number];

export const installationColumnLabels = {
	not_started: "Не начато",
	in_progress: "В работе",
	done: "Готово",
	processing: "В обработке",
} as const satisfies Record<InstallationColumnId, string>;

export type InstallationKksView = {
	id: string;
	name: string;
	itemType: InstallationKksItemType;
	sourceSheet: string;
	sourceRowIndex: number;
	sourceColumnLabel: string;
	matchedInCableBase: boolean;
	isDone: boolean;
	revision: number;
	updatedAt: string;
};

export type InstallationGroupView = {
	id: string;
	name: string;
	status: InstallationVisibleColumnId;
	doneCount: number;
	totalCount: number;
	progressPercent: number;
	kksItems: InstallationKksView[];
};

export type InstallationPendingChangeView = {
	id: string;
	kksItemId: string;
	kksName: string;
	baseDone: boolean;
	desiredDone: boolean;
	serverDone: boolean;
	hasConflict: boolean;
	userLogin: string;
	createdAt: string;
};

export type InstallationProcessingGroupView = {
	id: string;
	name: string;
	doneCount: number;
	totalCount: number;
	progressPercent: number;
	hasConflicts: boolean;
	changes: InstallationPendingChangeView[];
};

export type InstallationSnapshotView = {
	id: string;
	fileName: string;
	fileType: string;
	rowCount: number;
	groupCount: number;
	kksCount: number;
	cableCount: number;
	mechanismCount: number;
	baseMatchedCount: number;
	baseDoneCount: number;
	createdAt: string;
};

export type InstallationBoardData = {
	snapshot: InstallationSnapshotView | null;
	columns: Record<InstallationVisibleColumnId, InstallationGroupView[]>;
	processingGroups: InstallationProcessingGroupView[];
};

export type InstallationOfflineChange = {
	clientMutationId: string;
	snapshotId: string;
	groupId: string;
	kksItemId: string;
	baseDone: boolean;
	desiredDone: boolean;
};

export type InstallationKksChangeInput = {
	groupId: string;
	item: InstallationKksView;
	isDone: boolean;
};

export const saveInstallationKksSchema = z.object({
	snapshotId: z.string().uuid(),
	groupId: z.string().uuid(),
	kksItemId: z.string().uuid(),
	isDone: z.boolean(),
	baseRevision: z.number().int().positive(),
});

export const submitInstallationOfflineChangesSchema = z.object({
	snapshotId: z.string().uuid(),
	changes: z
		.array(
			z.object({
				clientMutationId: z.string().trim().min(1).max(120),
				groupId: z.string().uuid(),
				kksItemId: z.string().uuid(),
				baseDone: z.boolean(),
				desiredDone: z.boolean(),
			})
		)
		.min(1),
});

export const applyInstallationPendingGroupSchema = z.object({
	groupId: z.string().uuid(),
	changes: z
		.array(
			z.object({
				pendingChangeId: z.string().uuid(),
				resolvedDone: z.boolean(),
			})
		)
		.min(1),
});

export type SaveInstallationKksInput = z.infer<typeof saveInstallationKksSchema>;
export type SubmitInstallationOfflineChangesInput = z.infer<typeof submitInstallationOfflineChangesSchema>;
export type ApplyInstallationPendingGroupInput = z.infer<typeof applyInstallationPendingGroupSchema>;

export function getInstallationGroupStatus(
	doneCount: number,
	totalCount: number
): InstallationVisibleColumnId {
	if (doneCount === 0) return "not_started";
	if (doneCount >= totalCount) return "done";

	return "in_progress";
}

export function getInstallationProgressPercent(doneCount: number, totalCount: number) {
	if (totalCount === 0) return 0;

	return Math.round((doneCount / totalCount) * 100);
}

export function shouldShowInstallationProgress(
	group: Pick<InstallationGroupView, "doneCount" | "totalCount">
) {
	return group.doneCount > 0 && group.doneCount < group.totalCount;
}
