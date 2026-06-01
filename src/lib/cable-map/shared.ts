import * as z from "zod";

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

export const graphSideLabelsBySnapshotKind = {
	demolition: graphSideLabels,
	installation: {
		dirty: "Монтаж кабеля: сторона «Откуда»",
		clean: "Монтаж кабеля: сторона «Куда»",
	},
} as const satisfies Record<SnapshotKind, typeof graphSideLabels>;

export const graphSubzoneLabels = {
	dirty: "Грязная зона",
	clean: "Чистая зона",
} as const;

export const graphSubzoneLabelsBySnapshotKind = {
	demolition: graphSubzoneLabels,
	installation: {
		dirty: "Откуда",
		clean: "Куда",
	},
} as const satisfies Record<SnapshotKind, typeof graphSubzoneLabels>;

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
export const updatePriorityRoomKanbanStatusSchema = z.object({
	roomId: z.string().uuid(),
	status: priorityRoomKanbanStatusSchema,
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
