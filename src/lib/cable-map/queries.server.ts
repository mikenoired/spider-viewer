import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
	cableChangeAuditLogs,
	cableProgress,
	graphGroupRooms,
	graphGroups,
	importedCableRows,
	importSnapshots,
	manualGraphRooms,
	priorityRoomEntries,
	priorityRoomKanbanStates,
	priorityRoomLists,
	users,
} from "@/lib/db/schema";
import { enToRuVisual } from "@/lib/utils";

import type {
	DashboardData,
	DateRangeInput,
	GraphCableView,
	GraphGroupView,
	GraphManualRoomView,
	GraphRoomView,
	HistoryEntryView,
	PriorityKanbanRoomView,
	PriorityRoomListView,
	PriorityRoomKanbanStatus,
	SnapshotKind,
	SnapshotSummaryView,
} from "./shared";
import { shaftBucketLabels } from "./shared";

type HistoryQueryOptions = {
	backdatedOnly?: boolean;
	level?: string | null;
	snapshotKind?: SnapshotKind;
};

type DbClient = ReturnType<typeof getDb>;

function toIsoString(value: Date | string | null | undefined) {
	if (!value) {
		return "";
	}

	if (typeof value === "string") {
		return value;
	}

	return value.toISOString();
}

function compareRoomNames(left: string, right: string) {
	return left.localeCompare(right, "ru", {
		numeric: true,
		sensitivity: "base",
	});
}

const copperDensityKgPerMeterPerMm2 = 0.00889;
const cableSectionPattern = /(\d+)\s*[xх×]\s*(\d+(?:[.,]\d+)?)/gi;

function getImportedRowGroupKey(row: {
	graphSide: GraphGroupView["graphSide"];
	graphSubzone: GraphGroupView["graphSubzone"];
	sourceZone: string;
	level: string;
}) {
	return [row.graphSide, row.graphSubzone ?? "none", row.sourceZone || "unknown", row.level].join(":");
}

function parseCableCrossSection(cableLabel: string) {
	const matches = [...cableLabel.matchAll(cableSectionPattern)];
	const sectionValue = matches.at(-1)?.[2]?.replace(",", ".") ?? "";
	const parsedSection = Number(sectionValue);

	return Number.isFinite(parsedSection) ? parsedSection : 0;
}

function getCableCopperMassKg(row: {
	cableLabel: string;
	threadLength: number | null;
	threadCount: number | null;
}) {
	const cableCrossSection = parseCableCrossSection(row.cableLabel);
	const threadLength = row.threadLength ?? 0;
	const threadCount = row.threadCount ?? 0;

	if (cableCrossSection <= 0 || threadLength <= 0 || threadCount <= 0) {
		return 0;
	}

	return threadLength * threadCount * cableCrossSection * copperDensityKgPerMeterPerMm2;
}

async function getActiveSnapshot(db: DbClient, snapshotKind: SnapshotKind) {
	const [snapshot] = await db
		.select({
			id: importSnapshots.id,
			snapshotKind: importSnapshots.snapshotKind,
			fileName: importSnapshots.fileName,
			fileType: importSnapshots.fileType,
			rowCount: importSnapshots.rowCount,
			createdAt: importSnapshots.createdAt,
			importedByLogin: users.login,
		})
		.from(importSnapshots)
		.innerJoin(users, eq(users.id, importSnapshots.importedByUserId))
		.where(and(eq(importSnapshots.snapshotKind, snapshotKind), eq(importSnapshots.isActive, true)))
		.orderBy(desc(importSnapshots.createdAt))
		.limit(1);

	return snapshot ?? null;
}

async function getDashboardGroupRows(db: DbClient, snapshotId: string) {
	return db
		.select({
			groupId: graphGroups.id,
			groupKey: graphGroups.groupKey,
			graphSide: graphGroups.graphSide,
			graphSubzone: graphGroups.graphSubzone,
			sourceZone: graphGroups.sourceZone,
			level: graphGroups.level,
			levelOrder: graphGroups.levelOrder,
			groupCableCount: graphGroups.cableCount,
			groupThreadCount: graphGroups.threadCount,
			groupTotalLength: graphGroups.totalLength,
			noShaftThreads: graphGroups.noShaftThreads,
			shaft1Threads: graphGroups.shaft1Threads,
			shaft2Threads: graphGroups.shaft2Threads,
			shaft3Threads: graphGroups.shaft3Threads,
			shaft4Threads: graphGroups.shaft4Threads,
			roomId: graphGroupRooms.id,
			roomName: graphGroupRooms.roomName,
			roomRole: graphGroupRooms.roomRole,
			roomCableCount: graphGroupRooms.cableCount,
			roomThreadCount: graphGroupRooms.threadCount,
			roomTotalLength: graphGroupRooms.totalLength,
		})
		.from(graphGroups)
		.leftJoin(graphGroupRooms, eq(graphGroupRooms.groupId, graphGroups.id))
		.where(eq(graphGroups.snapshotId, snapshotId))
		.orderBy(
			desc(graphGroups.levelOrder),
			asc(graphGroups.graphSide),
			asc(graphGroups.sourceZone),
			asc(graphGroupRooms.roomRole),
			asc(graphGroupRooms.sortOrder)
		);
}

async function getDashboardImportedRows(db: DbClient, snapshotId: string) {
	return db
		.select({
			id: importedCableRows.id,
			graphSide: importedCableRows.graphSide,
			graphSubzone: importedCableRows.graphSubzone,
			sourceZone: importedCableRows.fromZone,
			level: importedCableRows.level,
			cableLabel: importedCableRows.cableLabel,
			cableJournal: importedCableRows.cableJournal,
			cableNumber: importedCableRows.cableNumber,
			fromRoom: importedCableRows.fromRoom,
			toRoom: importedCableRows.toRoom,
			threadLength: importedCableRows.threadLength,
			threadCount: importedCableRows.threadCount,
			totalLength: importedCableRows.totalLength,
			farthestShaft: importedCableRows.farthestShaft,
			progress: cableProgress.progress,
		})
		.from(importedCableRows)
		.leftJoin(
			cableProgress,
			and(
				eq(cableProgress.snapshotId, importedCableRows.snapshotId),
				eq(cableProgress.cableRowId, importedCableRows.id)
			)
		)
		.where(eq(importedCableRows.snapshotId, snapshotId));
}

async function getDashboardManualRoomRows(db: DbClient, rows: DashboardGroupRow[]) {
	const sourceZones = [...new Set(rows.map((row) => row.sourceZone))];
	const levels = [...new Set(rows.map((row) => row.level))];

	if (sourceZones.length === 0 || levels.length === 0) {
		return [];
	}

	return db
		.select({
			id: manualGraphRooms.id,
			roomName: manualGraphRooms.roomName,
			sourceZone: manualGraphRooms.sourceZone,
			level: manualGraphRooms.level,
		})
		.from(manualGraphRooms)
		.where(and(inArray(manualGraphRooms.sourceZone, sourceZones), inArray(manualGraphRooms.level, levels)));
}

async function getPriorityRoomRows(db: DbClient, snapshotId: string) {
	return db
		.select({
			roomName: priorityRoomEntries.roomName,
			normalizedRoomName: priorityRoomEntries.normalizedRoomName,
			authorName: priorityRoomLists.authorName,
		})
		.from(priorityRoomEntries)
		.innerJoin(priorityRoomLists, eq(priorityRoomLists.id, priorityRoomEntries.listId))
		.where(eq(priorityRoomEntries.snapshotId, snapshotId));
}

async function getPriorityRoomLists(db: DbClient, snapshotId: string) {
	return db
		.select({
			id: priorityRoomLists.id,
			authorName: priorityRoomLists.authorName,
			fileName: priorityRoomLists.fileName,
			fileType: priorityRoomLists.fileType,
			roomCount: priorityRoomLists.roomCount,
			importedByLogin: users.login,
			createdAt: priorityRoomLists.createdAt,
		})
		.from(priorityRoomLists)
		.innerJoin(users, eq(users.id, priorityRoomLists.importedByUserId))
		.where(eq(priorityRoomLists.snapshotId, snapshotId))
		.orderBy(desc(priorityRoomLists.createdAt));
}

async function getPriorityKanbanStateRows(db: DbClient, snapshotId: string) {
	return db
		.select({
			roomId: priorityRoomKanbanStates.roomId,
			status: priorityRoomKanbanStates.status,
			updatedByUserId: priorityRoomKanbanStates.updatedByUserId,
			checkedByUserId: priorityRoomKanbanStates.checkedByUserId,
			updatedAt: priorityRoomKanbanStates.updatedAt,
			checkedAt: priorityRoomKanbanStates.checkedAt,
		})
		.from(priorityRoomKanbanStates)
		.where(eq(priorityRoomKanbanStates.snapshotId, snapshotId));
}

async function getUserLoginsById(db: DbClient, userIds: string[]) {
	const uniqueUserIds = [...new Set(userIds.filter(Boolean))];

	if (uniqueUserIds.length === 0) {
		return new Map<string, string>();
	}

	const rows = await db
		.select({
			id: users.id,
			login: users.login,
		})
		.from(users)
		.where(inArray(users.id, uniqueUserIds));

	return new Map(rows.map((row) => [row.id, row.login]));
}

type DashboardSnapshotRow = NonNullable<Awaited<ReturnType<typeof getActiveSnapshot>>>;
type DashboardGroupRow = Awaited<ReturnType<typeof getDashboardGroupRows>>[number];
type DashboardImportedRow = Awaited<ReturnType<typeof getDashboardImportedRows>>[number];
type DashboardManualRoomRow = Awaited<ReturnType<typeof getDashboardManualRoomRows>>[number];
type PriorityRoomRow = Awaited<ReturnType<typeof getPriorityRoomRows>>[number];
type PriorityKanbanStateRow = Awaited<ReturnType<typeof getPriorityKanbanStateRows>>[number];

type PriorityKanbanMeta = {
	status: PriorityRoomKanbanStatus;
	updatedAt: string | null;
	updatedByLogin: string | null;
	checkedAt: string | null;
	checkedByLogin: string | null;
};

function normalizePriorityRoomName(value: string) {
	return enToRuVisual(value)
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

function buildPriorityAuthorsByRoom(rows: PriorityRoomRow[]) {
	const priorityAuthorsByRoom = new Map<string, string[]>();

	for (const row of rows) {
		const roomKey = normalizePriorityRoomName(row.normalizedRoomName || row.roomName);
		const authors = priorityAuthorsByRoom.get(roomKey) ?? [];

		if (!authors.includes(row.authorName)) {
			authors.push(row.authorName);
			authors.sort((left, right) => left.localeCompare(right, "ru", { sensitivity: "base" }));
			priorityAuthorsByRoom.set(roomKey, authors);
		}
	}

	return priorityAuthorsByRoom;
}

function getPriorityAuthors(priorityAuthorsByRoom: Map<string, string[]>, roomName: string) {
	return priorityAuthorsByRoom.get(normalizePriorityRoomName(roomName)) ?? [];
}

async function buildPriorityKanbanMetaByRoom(db: DbClient, rows: PriorityKanbanStateRow[]) {
	const userLoginsById = await getUserLoginsById(
		db,
		rows.flatMap((row) => [row.updatedByUserId, row.checkedByUserId ?? ""])
	);
	const metaByRoom = new Map<string, PriorityKanbanMeta>();

	for (const row of rows) {
		metaByRoom.set(row.roomId, {
			status: row.status,
			updatedAt: toIsoString(row.updatedAt),
			updatedByLogin: userLoginsById.get(row.updatedByUserId) ?? null,
			checkedAt: toIsoString(row.checkedAt),
			checkedByLogin: row.checkedByUserId ? (userLoginsById.get(row.checkedByUserId) ?? null) : null,
		});
	}

	return metaByRoom;
}

function getPriorityKanbanMeta(metaByRoom: Map<string, PriorityKanbanMeta>, roomId: string): PriorityKanbanMeta {
	return (
		metaByRoom.get(roomId) ?? {
			status: "in_progress",
			updatedAt: null,
			updatedByLogin: null,
			checkedAt: null,
			checkedByLogin: null,
		}
	);
}

function buildCopperMassByGroup(importedRows: DashboardImportedRow[]) {
	const copperMassByGroup = new Map<string, number>();

	for (const row of importedRows) {
		const groupKey = getImportedRowGroupKey(row);
		const currentMass = copperMassByGroup.get(groupKey) ?? 0;
		copperMassByGroup.set(groupKey, currentMass + getCableCopperMassKg(row));
	}

	return copperMassByGroup;
}

function createGraphGroup(row: DashboardGroupRow, copperMassByGroup: Map<string, number>): GraphGroupView {
	return {
		id: row.groupId,
		groupKey: row.groupKey,
		graphSide: row.graphSide,
		graphSubzone: row.graphSubzone,
		sourceZone: row.sourceZone,
		level: row.level,
		levelOrder: row.levelOrder,
		cableCount: row.groupCableCount,
		threadCount: row.groupThreadCount,
		totalLength: row.groupTotalLength,
		copperMassKg: copperMassByGroup.get(row.groupKey) ?? 0,
		averageProgress: 0,
		primaryRooms: [],
		secondaryRooms: [],
		manualRooms: [],
		buckets: [
			{
				shaft: 0,
				label: shaftBucketLabels[0],
				threadCount: row.noShaftThreads,
			},
			{
				shaft: 1,
				label: shaftBucketLabels[1],
				threadCount: row.shaft1Threads,
			},
			{
				shaft: 2,
				label: shaftBucketLabels[2],
				threadCount: row.shaft2Threads,
			},
			{
				shaft: 3,
				label: shaftBucketLabels[3],
				threadCount: row.shaft3Threads,
			},
			{
				shaft: 4,
				label: shaftBucketLabels[4],
				threadCount: row.shaft4Threads,
			},
		],
	};
}

function buildGraphRoom(
	row: DashboardGroupRow,
	priorityAuthorsByRoom: Map<string, string[]>,
	kanbanMetaByRoom: Map<string, PriorityKanbanMeta>
): GraphRoomView | null {
	if (!row.roomId || !row.roomName || !row.roomRole) {
		return null;
	}

	return {
		id: row.roomId,
		roomName: row.roomName,
		cableCount: row.roomCableCount ?? 0,
		threadCount: row.roomThreadCount ?? 0,
		totalLength: row.roomTotalLength ?? 0,
		progress: 0,
		roomRole: row.roomRole,
		priorityAuthors: getPriorityAuthors(priorityAuthorsByRoom, row.roomName),
		kanbanStatus: getPriorityKanbanMeta(kanbanMetaByRoom, row.roomId).status,
		cables: [],
	};
}

function appendRoomToGroup(group: GraphGroupView, room: GraphRoomView | null) {
	if (!room) {
		return;
	}

	if (room.roomRole === "primary") {
		group.primaryRooms.push(room);
		return;
	}

	group.secondaryRooms.push(room);
}

function buildGroups(
	rows: DashboardGroupRow[],
	copperMassByGroup: Map<string, number>,
	priorityAuthorsByRoom: Map<string, string[]>,
	kanbanMetaByRoom: Map<string, PriorityKanbanMeta>
) {
	const groups = new Map<string, GraphGroupView>();

	for (const row of rows) {
		const group = groups.get(row.groupId) ?? createGraphGroup(row, copperMassByGroup);
		groups.set(row.groupId, group);
		appendRoomToGroup(group, buildGraphRoom(row, priorityAuthorsByRoom, kanbanMetaByRoom));
	}

	return groups;
}

function normalizeShaft(shaft: number | null | undefined): GraphCableView["shaft"] {
	if (shaft === 1 || shaft === 2 || shaft === 3 || shaft === 4) {
		return shaft;
	}

	return 0;
}

function buildRoomIndex(groups: Map<string, GraphGroupView>) {
	const roomIndex = new Map<string, GraphRoomView>();

	for (const group of groups.values()) {
		for (const room of group.primaryRooms) {
			roomIndex.set(`${group.groupKey}:${room.roomName}`, room);
		}
	}

	return roomIndex;
}

function getAverageRoomProgress(cables: Pick<GraphCableView, "progress">[]) {
	if (cables.length === 0) {
		return 0;
	}

	return Math.round(cables.reduce((total, cable) => total + cable.progress, 0) / cables.length);
}

function appendImportedCablesToGroups(
	groups: Map<string, GraphGroupView>,
	importedRows: DashboardImportedRow[]
) {
	const roomIndex = buildRoomIndex(groups);

	for (const row of importedRows) {
		const groupKey = getImportedRowGroupKey(row);
		const room = roomIndex.get(`${groupKey}:${row.fromRoom}`);

		if (!room) {
			continue;
		}

		room.cables.push({
			id: row.id,
			cableLabel: row.cableLabel,
			cableJournal: row.cableJournal,
			cableNumber: row.cableNumber,
			fromRoom: row.fromRoom,
			toRoom: row.toRoom,
			threadLength: row.threadLength ?? 0,
			threadCount: row.threadCount ?? 0,
			totalLength: row.totalLength ?? 0,
			progress: row.progress ?? 0,
			shaft: normalizeShaft(row.farthestShaft),
		});
	}

	for (const group of groups.values()) {
		for (const room of group.primaryRooms) {
			room.cables.sort((left, right) => {
				if (left.shaft !== right.shaft) {
					return left.shaft - right.shaft;
				}

				return left.cableLabel.localeCompare(right.cableLabel, "ru", {
					numeric: true,
					sensitivity: "base",
				});
			});
			room.progress = getAverageRoomProgress(room.cables);
		}
	}
}

function buildManualRoomsByGroup(rows: DashboardManualRoomRow[]) {
	const manualRoomsByGroup = new Map<string, GraphManualRoomView[]>();

	for (const row of rows) {
		const groupKey = `${row.sourceZone}:${row.level}`;
		const rooms = manualRoomsByGroup.get(groupKey) ?? [];
		rooms.push({
			id: row.id,
			roomName: row.roomName,
		});
		manualRoomsByGroup.set(groupKey, rooms);
	}

	return manualRoomsByGroup;
}

function getAverageProgress(rooms: GraphRoomView[]) {
	if (rooms.length === 0) {
		return 0;
	}

	return Math.round(rooms.reduce((total, room) => total + room.progress, 0) / rooms.length);
}

type LevelEntry = {
	level: string;
	levelOrder: number;
	dirtyGroups: GraphGroupView[];
	cleanGroups: GraphGroupView[];
};

function buildDashboardLevels(
	groups: Map<string, GraphGroupView>,
	manualRoomsByGroup: Map<string, GraphManualRoomView[]>
) {
	const levelMap = new Map<string, LevelEntry>();
	const allPrimaryRooms: GraphRoomView[] = [];

	for (const group of groups.values()) {
		group.manualRooms =
			manualRoomsByGroup
				.get(`${group.sourceZone}:${group.level}`)
				?.sort((left, right) => compareRoomNames(left.roomName, right.roomName)) ?? [];
		group.averageProgress = getAverageProgress(group.primaryRooms);
		allPrimaryRooms.push(...group.primaryRooms);

		const levelEntry = levelMap.get(group.level) ?? {
			level: group.level,
			levelOrder: group.levelOrder,
			dirtyGroups: [],
			cleanGroups: [],
		};

		if (group.graphSide === "dirty") {
			levelEntry.dirtyGroups.push(group);
		} else {
			levelEntry.cleanGroups.push(group);
		}

		levelMap.set(group.level, levelEntry);
	}

	return {
		levels: [...levelMap.values()].sort((left, right) => right.levelOrder - left.levelOrder),
		allPrimaryRooms,
	};
}

function buildSnapshotSummary(
	snapshot: DashboardSnapshotRow,
	levels: LevelEntry[],
	groupCount: number,
	allPrimaryRooms: GraphRoomView[]
): SnapshotSummaryView {
	return {
		id: snapshot.id,
		snapshotKind: snapshot.snapshotKind,
		fileName: snapshot.fileName,
		fileType: snapshot.fileType,
		rowCount: snapshot.rowCount,
		createdAt: toIsoString(snapshot.createdAt),
		importedByLogin: snapshot.importedByLogin,
		levelCount: levels.length,
		groupCount,
		roomCount: allPrimaryRooms.length,
		averageProgress: getAverageProgress(allPrimaryRooms),
	};
}

function buildPriorityListSummary(rows: Awaited<ReturnType<typeof getPriorityRoomLists>>): PriorityRoomListView[] {
	return rows.map((row) => ({
		id: row.id,
		authorName: row.authorName,
		fileName: row.fileName,
		fileType: row.fileType,
		roomCount: row.roomCount,
		importedByLogin: row.importedByLogin,
		createdAt: toIsoString(row.createdAt),
	}));
}

function buildPriorityKanbanRooms(
	groups: Map<string, GraphGroupView>,
	kanbanMetaByRoom: Map<string, PriorityKanbanMeta>
): PriorityKanbanRoomView[] {
	const rooms: PriorityKanbanRoomView[] = [];

	for (const group of groups.values()) {
		for (const room of group.primaryRooms) {
			if (room.priorityAuthors.length === 0) {
				continue;
			}

			const meta = getPriorityKanbanMeta(kanbanMetaByRoom, room.id);
			rooms.push({
				roomId: room.id,
				roomName: room.roomName,
				groupId: group.id,
				level: group.level,
				sourceZone: group.sourceZone,
				graphSide: group.graphSide,
				progress: room.progress,
				cableCount: room.cableCount,
				threadCount: room.threadCount,
				priorityAuthors: room.priorityAuthors,
				status: meta.status,
				updatedAt: meta.updatedAt,
				updatedByLogin: meta.updatedByLogin,
				checkedAt: meta.checkedAt,
				checkedByLogin: meta.checkedByLogin,
			});
		}
	}

	return rooms.sort((left, right) => compareRoomNames(left.roomName, right.roomName));
}

export async function getActiveDashboardData(
	snapshotKind: SnapshotKind = "demolition"
): Promise<DashboardData> {
	const db = getDb();
	const snapshot = await getActiveSnapshot(db, snapshotKind);

	if (!snapshot) {
		return {
			snapshot: null,
			snapshotKind,
			priorityLists: [],
			priorityRoomCount: 0,
			priorityKanbanRooms: [],
			levels: [],
		};
	}

	const [rows, importedRows, priorityRows, priorityLists, kanbanStateRows] = await Promise.all([
		getDashboardGroupRows(db, snapshot.id),
		getDashboardImportedRows(db, snapshot.id),
		getPriorityRoomRows(db, snapshot.id),
		getPriorityRoomLists(db, snapshot.id),
		getPriorityKanbanStateRows(db, snapshot.id),
	]);
	const manualRoomRows = await getDashboardManualRoomRows(db, rows);
	const copperMassByGroup = buildCopperMassByGroup(importedRows);
	const priorityAuthorsByRoom = buildPriorityAuthorsByRoom(priorityRows);
	const kanbanMetaByRoom = await buildPriorityKanbanMetaByRoom(db, kanbanStateRows);
	const groups = buildGroups(rows, copperMassByGroup, priorityAuthorsByRoom, kanbanMetaByRoom);
	appendImportedCablesToGroups(groups, importedRows);
	const manualRoomsByGroup = buildManualRoomsByGroup(manualRoomRows);
	const { levels, allPrimaryRooms } = buildDashboardLevels(groups, manualRoomsByGroup);

	return {
		snapshot: buildSnapshotSummary(snapshot, levels, groups.size, allPrimaryRooms),
		snapshotKind,
		priorityLists: buildPriorityListSummary(priorityLists),
		priorityRoomCount: priorityAuthorsByRoom.size,
		priorityKanbanRooms: buildPriorityKanbanRooms(groups, kanbanMetaByRoom),
		levels,
	};
}

function buildHistoryConditions(range?: DateRangeInput, options: HistoryQueryOptions = {}) {
	const conditions = [];

	if (options.backdatedOnly) {
		conditions.push(eq(cableChangeAuditLogs.isBackdated, true));
	}

	if (range?.from) {
		conditions.push(gte(cableChangeAuditLogs.effectiveDate, range.from));
	}

	if (range?.to) {
		conditions.push(lte(cableChangeAuditLogs.effectiveDate, range.to));
	}

	if (options.level?.trim()) {
		conditions.push(eq(graphGroups.level, options.level.trim()));
	}

	if (options.snapshotKind) {
		conditions.push(eq(importSnapshots.snapshotKind, options.snapshotKind));
	}

	return conditions;
}

export async function getHistoryEntries(range?: DateRangeInput, options: HistoryQueryOptions = {}) {
	const db = getDb();
	const conditions = buildHistoryConditions(range, options);
	const result = await db
		.select({
			id: cableChangeAuditLogs.id,
			cableId: cableChangeAuditLogs.cableRowId,
			cableLabel: cableChangeAuditLogs.cableLabel,
			roomName: cableChangeAuditLogs.roomName,
			shaft: cableChangeAuditLogs.shaft,
			userLogin: cableChangeAuditLogs.userLogin,
			oldProgress: cableChangeAuditLogs.oldProgress,
			newProgress: cableChangeAuditLogs.newProgress,
			changedAt: cableChangeAuditLogs.changedAt,
			effectiveDate: cableChangeAuditLogs.effectiveDate,
			isBackdated: cableChangeAuditLogs.isBackdated,
			groupId: cableChangeAuditLogs.groupId,
			level: graphGroups.level,
			levelOrder: graphGroups.levelOrder,
		})
		.from(cableChangeAuditLogs)
		.leftJoin(graphGroups, eq(graphGroups.id, cableChangeAuditLogs.groupId))
		.leftJoin(importSnapshots, eq(importSnapshots.id, cableChangeAuditLogs.snapshotId))
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(desc(cableChangeAuditLogs.changedAt));

	return result.map(
		(entry) =>
			({
				id: entry.id,
				cableId: entry.cableId,
				cableLabel: entry.cableLabel,
				roomName: entry.roomName,
				shaft: entry.shaft,
				userLogin: entry.userLogin,
				oldProgress: entry.oldProgress,
				newProgress: entry.newProgress,
				changedAt: toIsoString(entry.changedAt),
				effectiveDate: entry.effectiveDate,
				isBackdated: entry.isBackdated,
				groupId: entry.groupId,
				level: entry.level ?? null,
				levelOrder: entry.levelOrder ?? null,
			}) satisfies HistoryEntryView
	);
}
