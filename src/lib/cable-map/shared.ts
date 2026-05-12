import { z } from "zod";

export const supportedWorkbookExtensions = ["ods", "xlsx", "xls"] as const;
export const supportedWorkbookMimeTypes = [
	"application/vnd.oasis.opendocument.spreadsheet",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.ms-excel",
] as const;

export const graphSideLabels = {
	dirty: "Демонтаж кабеля САЭ со стороны грязной зоны",
	clean: "Демонтаж кабеля САЭ со стороны чистой зоны",
} as const;

export const graphSubzoneLabels = {
	dirty: "Грязная зона",
	clean: "Чистая зона",
} as const;

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
	roomId: z.uuid(),
	cableId: z.uuid(),
	progress: z.number().int().min(0).max(100),
});

export const saveCableProgressSchema = z.object({
	groupId: z.uuid(),
	effectiveDate: z.string().trim().optional().nullable(),
	cables: z.array(cableProgressPatchSchema).min(1),
});

export const createManualRoomSchema = z.object({
	groupId: z.uuid(),
	roomName: z
		.string()
		.trim()
		.min(1, "Введите название помещения.")
		.max(120, "Название помещения не должно быть длиннее 120 символов."),
});

export const deleteManualRoomSchema = z.object({
	roomId: z.uuid(),
});

export const exportHistorySchema = dateRangeSchema.extend({
	fileName: z.string().trim().optional().nullable(),
});
export const exportBackdatedSchema = exportHistorySchema;
export const exportDailyHistorySchema = z.object({
	fileName: z.string().trim().optional().nullable(),
	level: z.string().trim().min(1).optional().nullable(),
});

export type DateRangeInput = z.infer<typeof dateRangeSchema>;
export type SaveCableProgressInput = z.infer<typeof saveCableProgressSchema>;
export type CreateManualRoomInput = z.infer<typeof createManualRoomSchema>;
export type DeleteManualRoomInput = z.infer<typeof deleteManualRoomSchema>;
export type ExportHistoryInput = z.infer<typeof exportHistorySchema>;
export type ExportBackdatedInput = ExportHistoryInput;
export type ExportDailyHistoryInput = z.infer<typeof exportDailyHistorySchema>;

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

export type DashboardData = {
	snapshot: SnapshotSummaryView | null;
	levels: Array<{
		level: string;
		levelOrder: number;
		dirtyGroups: GraphGroupView[];
		cleanGroups: GraphGroupView[];
	}>;
};
