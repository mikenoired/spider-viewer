import * as z from "zod";

import { userDepartmentSchema } from "@/lib/auth/shared";

export const supportedWorkbookExtensions = ["ods", "xlsx", "xls"] as const;
export const supportedWorkbookMimeTypes = [
	"application/vnd.oasis.opendocument.spreadsheet",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.ms-excel",
] as const;
export const supportedPriorityListExtensions = [...supportedWorkbookExtensions] as const;

export const snapshotKinds = ["demolition", "installation"] as const;
export type SnapshotKind = (typeof snapshotKinds)[number];

export const snapshotKindLabels = {
	demolition: "Демонтаж",
	installation: "Монтаж",
} as const satisfies Record<SnapshotKind, string>;

export const mapTitleBySnapshotKind = {
	demolition: "Демонтаж кабеля САЭ в части 1 канала СБ и НЭ энергоблока № 1",
	installation: "Монтаж кабеля УСБТ в помещении 1АЭ408/1",
} as const satisfies Record<SnapshotKind, string>;

export const graphSideLabels = {
	dirty: "Демонтаж кабеля САЭ со стороны грязной зоны",
	clean: "Демонтаж кабеля САЭ со стороны чистой зоны",
} as const;
type GraphSideLabels = Record<keyof typeof graphSideLabels, string>;

export const graphSideLabelsBySnapshotKind = {
	demolition: graphSideLabels,
	installation: {
		dirty: "Монтаж кабеля: сторона «Откуда»",
		clean: "Монтаж кабеля: сторона «Куда»",
	},
} as const satisfies Record<SnapshotKind, GraphSideLabels>;

export const graphSubzoneLabels = {
	dirty: "Грязная зона",
	clean: "Чистая зона",
} as const;
type GraphSubzoneLabels = Record<keyof typeof graphSubzoneLabels, string>;

export const graphSubzoneLabelsBySnapshotKind = {
	demolition: graphSubzoneLabels,
	installation: {
		dirty: "Откуда",
		clean: "Куда",
	},
} as const satisfies Record<SnapshotKind, GraphSubzoneLabels>;

export const shaftBucketLabels = {
	0: "Не заходит в КШ",
	1: "В КШ 1",
	2: "В КШ 2",
	3: "В КШ 3",
	4: "В КШ 4",
} as const;

export const dateRangeSchema = z.object({
	from: z.string().trim().optional().nullable(),
	to: z.string().trim().optional().nullable(),
});

export const cableProgressPatchSchema = z.object({
	roomId: z.string().uuid(),
	cableId: z.string().uuid(),
	progress: z.number().int().min(0).max(100),
});

export const saveCableProgressSchema = z.object({
	groupId: z.string().uuid(),
	effectiveDate: z.string().trim().optional().nullable(),
	cables: z.array(cableProgressPatchSchema).min(1),
});

export const createManualRoomSchema = z.object({
	groupId: z.string().uuid(),
	roomName: z
		.string()
		.trim()
		.min(1, "Введите название помещения.")
		.max(120, "Название помещения не должно быть длиннее 120 символов."),
});

export const deleteManualRoomSchema = z.object({
	roomId: z.string().uuid(),
});

export const exportHistorySchema = dateRangeSchema.extend({
	fileName: z.string().trim().optional().nullable(),
});
export const exportBackdatedSchema = exportHistorySchema;
export const exportDailyHistorySchema = z.object({
	fileName: z.string().trim().optional().nullable(),
	level: z.string().trim().min(1).optional().nullable(),
	snapshotKind: z.enum(snapshotKinds).optional().default("demolition"),
});
export const priorityRoomListAuthorSchema = z
	.string()
	.trim()
	.min(2, "Укажите автора списка.")
	.max(120, "Имя автора не должно быть длиннее 120 символов.");
export const priorityRoomKanbanStatuses = ["in_progress", "done", "checked"] as const;
export const priorityRoomKanbanStatusSchema = z.enum(priorityRoomKanbanStatuses);
export const priorityListKanbanStatuses = [
	"formed",
	"in_progress",
	"curator_review",
	"adjustment",
	"done",
] as const;
export const priorityListKanbanStatusSchema = z.enum(priorityListKanbanStatuses);
export const updatePriorityRoomKanbanStatusSchema = z.object({
	roomId: z.string().uuid(),
	status: priorityRoomKanbanStatusSchema,
});
export const updatePriorityListKanbanStatusSchema = z.object({
	listId: z.string().uuid(),
	status: priorityListKanbanStatusSchema,
});
export const kanbanTaskActionSchema = z.enum(["move", "accept", "complete", "confirm", "return"]);
export const transitionKanbanTaskSchema = z.object({
	listId: z.string().uuid(),
	action: kanbanTaskActionSchema,
	status: priorityListKanbanStatusSchema.optional(),
	recipientDepartment: userDepartmentSchema.optional(),
});
export const createTaskCommentSchema = z.object({
	listId: z.string().uuid(),
	content: z.string().trim().min(1, "Введите комментарий.").max(4_000, "Комментарий слишком длинный."),
});
export const createKanbanRemarkSchema = z.object({
	listId: z.string().uuid(),
	cableId: z.string().uuid().optional(),
	content: z.string().trim().min(3, "Опишите замечание.").max(4_000, "Замечание слишком длинное."),
	assignedDepartment: userDepartmentSchema.optional(),
	assignedUserId: z.string().uuid().optional(),
});
export const remarkTargetTypes = ["cable_change", "room_change", "priority_list", "cable"] as const;
export const remarkTargetTypeSchema = z.enum(remarkTargetTypes);
export const remarkStatuses = ["open", "resolved"] as const;
export const remarkStatusSchema = z.enum(remarkStatuses);
export const createRemarkSchema = z.object({
	targetType: remarkTargetTypeSchema,
	targetId: z.string().uuid(),
	content: z.string().trim().min(3, "Опишите замечание.").max(4_000, "Замечание слишком длинное."),
});
export const updateRemarkStatusSchema = z.object({
	remarkId: z.string().uuid(),
	status: remarkStatusSchema,
});

export type DateRangeInput = z.infer<typeof dateRangeSchema>;
export type SaveCableProgressInput = z.infer<typeof saveCableProgressSchema>;
export type CreateManualRoomInput = z.infer<typeof createManualRoomSchema>;
export type DeleteManualRoomInput = z.infer<typeof deleteManualRoomSchema>;
export type ExportHistoryInput = z.infer<typeof exportHistorySchema>;
export type ExportBackdatedInput = ExportHistoryInput;
export type ExportDailyHistoryInput = z.infer<typeof exportDailyHistorySchema>;
export type PriorityRoomKanbanStatus = z.infer<typeof priorityRoomKanbanStatusSchema>;
export type UpdatePriorityRoomKanbanStatusInput = z.infer<typeof updatePriorityRoomKanbanStatusSchema>;
export type PriorityListKanbanStatus = z.infer<typeof priorityListKanbanStatusSchema>;
export type UpdatePriorityListKanbanStatusInput = z.infer<typeof updatePriorityListKanbanStatusSchema>;
export type TransitionKanbanTaskInput = z.infer<typeof transitionKanbanTaskSchema>;
export type CreateTaskCommentInput = z.infer<typeof createTaskCommentSchema>;
export type CreateKanbanRemarkInput = z.infer<typeof createKanbanRemarkSchema>;
export type RemarkTargetType = z.infer<typeof remarkTargetTypeSchema>;
export type RemarkStatus = z.infer<typeof remarkStatusSchema>;
export type CreateRemarkInput = z.infer<typeof createRemarkSchema>;
export type UpdateRemarkStatusInput = z.infer<typeof updateRemarkStatusSchema>;

export type HistoryEntryView = {
	id: string;
	cableId: string | null;
	cableLabel: string;
	roomName: string;
	shaft: number;
	userLogin: string;
	oldProgress: number;
	newProgress: number;
	changedAt: string;
	effectiveDate: string;
	isBackdated: boolean;
	groupId: string | null;
	level: string | null;
	levelOrder: number | null;
};

export type GraphBucketView = {
	shaft: 0 | 1 | 2 | 3 | 4;
	label: string;
	threadCount: number;
};

export type GraphCableView = {
	id: string;
	cableLabel: string;
	cableJournal: string;
	cableNumber: string;
	fromRoom: string;
	toRoom: string;
	threadLength: number;
	threadCount: number;
	totalLength: number;
	progress: number;
	shaft: 0 | 1 | 2 | 3 | 4;
};

export type GraphRoomView = {
	id: string;
	roomName: string;
	cableCount: number;
	threadCount: number;
	totalLength: number;
	progress: number;
	roomRole: "primary" | "secondary";
	priorityAuthors: string[];
	kanbanStatus: PriorityRoomKanbanStatus;
	cables: GraphCableView[];
};

export type GraphManualRoomView = {
	id: string;
	roomName: string;
};

export type GraphGroupView = {
	id: string;
	groupKey: string;
	graphSide: "dirty" | "clean";
	graphSubzone: "dirty" | "clean" | null;
	sourceZone: string;
	level: string;
	levelOrder: number;
	cableCount: number;
	threadCount: number;
	totalLength: number;
	copperMassKg: number;
	averageProgress: number;
	primaryRooms: GraphRoomView[];
	secondaryRooms: GraphRoomView[];
	manualRooms: GraphManualRoomView[];
	buckets: GraphBucketView[];
};

export type SnapshotSummaryView = {
	id: string;
	snapshotKind: SnapshotKind;
	fileName: string;
	fileType: string;
	rowCount: number;
	createdAt: string;
	importedByLogin: string;
	levelCount: number;
	groupCount: number;
	roomCount: number;
	averageProgress: number;
};

export type PriorityRoomListView = {
	id: string;
	authorName: string;
	fileName: string;
	fileType: string;
	roomCount: number;
	importedByLogin: string;
	createdAt: string;
	status: PriorityListKanbanStatus;
	statusUpdatedAt: string | null;
	statusUpdatedByLogin: string | null;
	senderDepartment: "tai" | "skm" | "commissioning" | "curator";
	recipientDepartment: "tai" | "skm" | "commissioning" | "curator" | null;
	responsibleLogin: string | null;
	acceptedAt: string | null;
	completedAt: string | null;
	verifiedAt: string | null;
	commentCount: number;
	remarkCount: number;
};

export type RemarkView = {
	id: string;
	targetType: RemarkTargetType;
	targetId: string;
	targetLabel: string;
	content: string;
	status: RemarkStatus;
	createdAt: string;
	createdByLogin: string;
	resolvedAt: string | null;
	resolvedByLogin: string | null;
};

export type RemarkTargetView = {
	type: RemarkTargetType;
	id: string;
	label: string;
	details: string;
};

export type RemarksData = {
	remarks: RemarkView[];
	targets: RemarkTargetView[];
};

export type PriorityKanbanRoomView = {
	roomId: string;
	roomName: string;
	groupId: string;
	level: string;
	sourceZone: string;
	graphSide: "dirty" | "clean";
	progress: number;
	cableCount: number;
	threadCount: number;
	priorityAuthors: string[];
	status: PriorityRoomKanbanStatus;
	updatedAt: string | null;
	updatedByLogin: string | null;
	checkedAt: string | null;
	checkedByLogin: string | null;
};

export type DashboardData = {
	snapshot: SnapshotSummaryView | null;
	snapshotKind: SnapshotKind;
	priorityLists: PriorityRoomListView[];
	priorityRoomCount: number;
	priorityKanbanRooms: PriorityKanbanRoomView[];
	levels: Array<{
		level: string;
		levelOrder: number;
		dirtyGroups: GraphGroupView[];
		cleanGroups: GraphGroupView[];
	}>;
};
