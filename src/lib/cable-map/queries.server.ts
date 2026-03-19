import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
	changeAuditLogs,
	graphGroupRooms,
	graphGroups,
	importedCableRows,
	importSnapshots,
	manualGraphRooms,
	users,
} from "@/lib/db/schema";
import type {
	DashboardData,
	DateRangeInput,
	GraphGroupView,
	GraphManualRoomView,
	GraphRoomView,
	HistoryEntryView,
	SnapshotSummaryView,
} from "./shared";
import { shaftBucketLabels } from "./shared";

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
	return [
		row.graphSide,
		row.graphSubzone ?? "none",
		row.sourceZone || "unknown",
		row.level,
	].join(":");
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

	return (
		threadLength *
		threadCount *
		cableCrossSection *
		copperDensityKgPerMeterPerMm2
	);
}

export async function getActiveDashboardData(): Promise<DashboardData> {
	const db = getDb();
	const [snapshot] = await db
		.select({
			id: importSnapshots.id,
			fileName: importSnapshots.fileName,
			fileType: importSnapshots.fileType,
			rowCount: importSnapshots.rowCount,
			createdAt: importSnapshots.createdAt,
			importedByLogin: users.login,
		})
		.from(importSnapshots)
		.innerJoin(users, eq(users.id, importSnapshots.importedByUserId))
		.where(eq(importSnapshots.isActive, true))
		.orderBy(desc(importSnapshots.createdAt))
		.limit(1);

	if (!snapshot) {
		return {
			snapshot: null,
			levels: [],
		};
	}

	const rows = await db
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
			roomProgress: graphGroupRooms.progress,
			roomEffectiveDate: graphGroupRooms.effectiveDate,
		})
		.from(graphGroups)
		.leftJoin(graphGroupRooms, eq(graphGroupRooms.groupId, graphGroups.id))
		.where(eq(graphGroups.snapshotId, snapshot.id))
		.orderBy(
			desc(graphGroups.levelOrder),
			asc(graphGroups.graphSide),
			asc(graphGroups.sourceZone),
			asc(graphGroupRooms.roomRole),
			asc(graphGroupRooms.sortOrder),
		);
	const importedRows = await db
		.select({
			graphSide: importedCableRows.graphSide,
			graphSubzone: importedCableRows.graphSubzone,
			sourceZone: importedCableRows.fromZone,
			level: importedCableRows.level,
			cableLabel: importedCableRows.cableLabel,
			threadLength: importedCableRows.threadLength,
			threadCount: importedCableRows.threadCount,
		})
		.from(importedCableRows)
		.where(eq(importedCableRows.snapshotId, snapshot.id));
	const manualRoomRows = await db
		.select({
			id: manualGraphRooms.id,
			roomName: manualGraphRooms.roomName,
			sourceZone: manualGraphRooms.sourceZone,
			level: manualGraphRooms.level,
		})
		.from(manualGraphRooms);
	const copperMassByGroup = new Map<string, number>();

	for (const row of importedRows) {
		const groupKey = getImportedRowGroupKey(row);
		const currentMass = copperMassByGroup.get(groupKey) ?? 0;
		const nextMass = currentMass + getCableCopperMassKg(row);

		copperMassByGroup.set(groupKey, nextMass);
	}

	const groups = new Map<string, GraphGroupView>();

	for (const row of rows) {
		const existingGroup = groups.get(row.groupId);
		const group =
			existingGroup ??
			({
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
			} satisfies GraphGroupView);

		if (!existingGroup) {
			groups.set(row.groupId, group);
		}

		if (!row.roomId || !row.roomName || !row.roomRole) {
			continue;
		}

		const room: GraphRoomView = {
			id: row.roomId,
			roomName: row.roomName,
			cableCount: row.roomCableCount ?? 0,
			threadCount: row.roomThreadCount ?? 0,
			totalLength: row.roomTotalLength ?? 0,
			progress: row.roomProgress ?? 0,
			roomRole: row.roomRole,
			effectiveDate: row.roomEffectiveDate ?? null,
		};

		if (row.roomRole === "primary") {
			group.primaryRooms.push(room);
		} else {
			group.secondaryRooms.push(room);
		}
	}

	const manualRoomsByGroup = new Map<string, GraphManualRoomView[]>();

	for (const row of manualRoomRows) {
		const groupKey = `${row.sourceZone}:${row.level}`;
		const rooms = manualRoomsByGroup.get(groupKey) ?? [];
		rooms.push({
			id: row.id,
			roomName: row.roomName,
		});
		manualRoomsByGroup.set(groupKey, rooms);
	}

	const levelMap = new Map<
		string,
		{
			level: string;
			levelOrder: number;
			dirtyGroups: GraphGroupView[];
			cleanGroups: GraphGroupView[];
		}
	>();
	const allPrimaryRooms: GraphRoomView[] = [];

	for (const group of groups.values()) {
		group.manualRooms =
			manualRoomsByGroup
				.get(`${group.sourceZone}:${group.level}`)
				?.sort((left, right) =>
					compareRoomNames(left.roomName, right.roomName),
				) ?? [];
		const averageProgress =
			group.primaryRooms.length > 0
				? Math.round(
						group.primaryRooms.reduce(
							(total, room) => total + room.progress,
							0,
						) / group.primaryRooms.length,
					)
				: 0;
		group.averageProgress = averageProgress;
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

	const levels = [...levelMap.values()].sort(
		(left, right) => right.levelOrder - left.levelOrder,
	);

	const snapshotSummary: SnapshotSummaryView = {
		id: snapshot.id,
		fileName: snapshot.fileName,
		fileType: snapshot.fileType,
		rowCount: snapshot.rowCount,
		createdAt: toIsoString(snapshot.createdAt),
		importedByLogin: snapshot.importedByLogin,
		levelCount: levels.length,
		groupCount: groups.size,
		roomCount: allPrimaryRooms.length,
		averageProgress:
			allPrimaryRooms.length > 0
				? Math.round(
						allPrimaryRooms.reduce((total, room) => total + room.progress, 0) /
							allPrimaryRooms.length,
					)
				: 0,
	};

	return {
		snapshot: snapshotSummary,
		levels,
	};
}

function buildDateConditions(range?: DateRangeInput, backdatedOnly = false) {
	const conditions = [];

	if (backdatedOnly) {
		conditions.push(eq(changeAuditLogs.isBackdated, true));
	}

	if (range?.from) {
		conditions.push(gte(changeAuditLogs.effectiveDate, range.from));
	}

	if (range?.to) {
		conditions.push(lte(changeAuditLogs.effectiveDate, range.to));
	}

	return conditions;
}

export async function getHistoryEntries(
	range?: DateRangeInput,
	backdatedOnly = false,
) {
	const db = getDb();
	const conditions = buildDateConditions(range, backdatedOnly);
	const result = await db
		.select({
			id: changeAuditLogs.id,
			roomName: changeAuditLogs.roomName,
			userLogin: changeAuditLogs.userLogin,
			oldProgress: changeAuditLogs.oldProgress,
			newProgress: changeAuditLogs.newProgress,
			changedAt: changeAuditLogs.changedAt,
			effectiveDate: changeAuditLogs.effectiveDate,
			isBackdated: changeAuditLogs.isBackdated,
			groupId: changeAuditLogs.groupId,
		})
		.from(changeAuditLogs)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(desc(changeAuditLogs.changedAt));

	return result.map(
		(entry) =>
			({
				id: entry.id,
				roomName: entry.roomName,
				userLogin: entry.userLogin,
				oldProgress: entry.oldProgress,
				newProgress: entry.newProgress,
				changedAt: toIsoString(entry.changedAt),
				effectiveDate: entry.effectiveDate,
				isBackdated: entry.isBackdated,
				groupId: entry.groupId,
			}) satisfies HistoryEntryView,
	);
}
