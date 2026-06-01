import { and, asc, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
	installationKksGroups,
	installationKksItems,
	installationPendingChanges,
	installationSnapshots,
} from "@/lib/db/schema";

import {
	getInstallationGroupStatus,
	getInstallationProgressPercent,
	type InstallationBoardData,
	type InstallationGroupView,
	type InstallationKksView,
	type InstallationPendingChangeView,
	type InstallationProcessingGroupView,
	type InstallationSnapshotView,
	type InstallationVisibleColumnId,
} from "./shared";

type DbClient = ReturnType<typeof getDb>;
type ActiveInstallationSnapshot = NonNullable<Awaited<ReturnType<typeof getActiveInstallationSnapshot>>>;
type InstallationGroupRow = Awaited<ReturnType<typeof getInstallationGroupRows>>[number];
type InstallationItemRow = Awaited<ReturnType<typeof getInstallationItemRows>>[number];
type InstallationPendingRow = Awaited<ReturnType<typeof getInstallationPendingRows>>[number];

function toIsoString(value: Date | string | null | undefined) {
	if (!value) return "";
	if (typeof value === "string") return value;

	return value.toISOString();
}

function createEmptyColumns(): Record<InstallationVisibleColumnId, InstallationGroupView[]> {
	return {
		not_started: [],
		in_progress: [],
		done: [],
	};
}

async function getActiveInstallationSnapshot(db: DbClient) {
	const [snapshot] = await db
		.select({
			id: installationSnapshots.id,
			fileName: installationSnapshots.fileName,
			fileType: installationSnapshots.fileType,
			rowCount: installationSnapshots.rowCount,
			summary: installationSnapshots.summary,
			createdAt: installationSnapshots.createdAt,
		})
		.from(installationSnapshots)
		.where(eq(installationSnapshots.isActive, true))
		.orderBy(desc(installationSnapshots.createdAt))
		.limit(1);

	return snapshot ?? null;
}

function createSnapshotView(snapshot: ActiveInstallationSnapshot): InstallationSnapshotView {
	return {
		id: snapshot.id,
		fileName: snapshot.fileName,
		fileType: snapshot.fileType,
		rowCount: snapshot.rowCount,
		groupCount: snapshot.summary.groupCount,
		kksCount: snapshot.summary.kksCount,
		cableCount: snapshot.summary.cableCount ?? 0,
		mechanismCount: snapshot.summary.mechanismCount ?? 0,
		baseMatchedCount: snapshot.summary.baseMatchedCount ?? 0,
		baseDoneCount: snapshot.summary.baseDoneCount ?? 0,
		createdAt: toIsoString(snapshot.createdAt),
	};
}

async function getInstallationGroupRows(db: DbClient, snapshotId: string) {
	return db
		.select({
			id: installationKksGroups.id,
			name: installationKksGroups.name,
			kksCount: installationKksGroups.kksCount,
		})
		.from(installationKksGroups)
		.where(eq(installationKksGroups.snapshotId, snapshotId))
		.orderBy(asc(installationKksGroups.sortOrder), asc(installationKksGroups.name));
}

async function getInstallationItemRows(db: DbClient, snapshotId: string) {
	return db
		.select({
			id: installationKksItems.id,
			groupId: installationKksItems.groupId,
			name: installationKksItems.name,
			itemType: installationKksItems.itemType,
			sourceSheet: installationKksItems.sourceSheet,
			sourceRowIndex: installationKksItems.sourceRowIndex,
			sourceColumnLabel: installationKksItems.sourceColumnLabel,
			matchedInCableBase: installationKksItems.matchedInCableBase,
			isDone: installationKksItems.isDone,
			revision: installationKksItems.revision,
			updatedAt: installationKksItems.updatedAt,
		})
		.from(installationKksItems)
		.where(eq(installationKksItems.snapshotId, snapshotId))
		.orderBy(
			asc(installationKksItems.groupId),
			asc(installationKksItems.sortOrder),
			asc(installationKksItems.name)
		);
}

async function getInstallationPendingRows(db: DbClient, snapshotId: string) {
	return db
		.select({
			id: installationPendingChanges.id,
			groupId: installationPendingChanges.groupId,
			kksItemId: installationPendingChanges.kksItemId,
			baseDone: installationPendingChanges.baseDone,
			desiredDone: installationPendingChanges.desiredDone,
			serverDone: installationPendingChanges.serverDone,
			hasConflict: installationPendingChanges.hasConflict,
			userLogin: installationPendingChanges.userLogin,
			createdAt: installationPendingChanges.createdAt,
		})
		.from(installationPendingChanges)
		.where(
			and(
				eq(installationPendingChanges.snapshotId, snapshotId),
				eq(installationPendingChanges.status, "pending")
			)
		)
		.orderBy(asc(installationPendingChanges.createdAt));
}

function groupItemsByGroupId(rows: InstallationItemRow[]) {
	const itemsByGroupId = new Map<string, InstallationKksView[]>();

	for (const row of rows) {
		const items = itemsByGroupId.get(row.groupId) ?? [];
		items.push({
			id: row.id,
			name: row.name,
			itemType: row.itemType,
			sourceSheet: row.sourceSheet,
			sourceRowIndex: row.sourceRowIndex,
			sourceColumnLabel: row.sourceColumnLabel,
			matchedInCableBase: row.matchedInCableBase,
			isDone: row.isDone,
			revision: row.revision,
			updatedAt: toIsoString(row.updatedAt),
		});
		itemsByGroupId.set(row.groupId, items);
	}

	return itemsByGroupId;
}

function createInstallationGroup(row: InstallationGroupRow, kksItems: InstallationKksView[]) {
	const doneCount = kksItems.filter((item) => item.isDone).length;
	const totalCount = row.kksCount;

	return {
		id: row.id,
		name: row.name,
		status: getInstallationGroupStatus(doneCount, totalCount),
		doneCount,
		totalCount,
		progressPercent: getInstallationProgressPercent(doneCount, totalCount),
		kksItems,
	} satisfies InstallationGroupView;
}

function buildColumns(groupRows: InstallationGroupRow[], itemRows: InstallationItemRow[]) {
	const columns = createEmptyColumns();
	const itemsByGroupId = groupItemsByGroupId(itemRows);

	for (const row of groupRows) {
		const group = createInstallationGroup(row, itemsByGroupId.get(row.id) ?? []);
		columns[group.status].push(group);
	}

	return columns;
}

function buildPendingChange(row: InstallationPendingRow, itemById: Map<string, InstallationItemRow>) {
	const item = itemById.get(row.kksItemId);

	return {
		id: row.id,
		kksItemId: row.kksItemId,
		kksName: item?.name ?? "KKS",
		baseDone: row.baseDone,
		desiredDone: row.desiredDone,
		serverDone: row.serverDone,
		hasConflict: row.hasConflict,
		userLogin: row.userLogin,
		createdAt: toIsoString(row.createdAt),
	} satisfies InstallationPendingChangeView;
}

function buildProcessingGroups(
	groupRows: InstallationGroupRow[],
	itemRows: InstallationItemRow[],
	pendingRows: InstallationPendingRow[]
) {
	const groupById = new Map(groupRows.map((group) => [group.id, group]));
	const itemById = new Map(itemRows.map((item) => [item.id, item]));
	const changesByGroupId = new Map<string, InstallationPendingChangeView[]>();

	for (const row of pendingRows) {
		const changes = changesByGroupId.get(row.groupId) ?? [];
		changes.push(buildPendingChange(row, itemById));
		changesByGroupId.set(row.groupId, changes);
	}

	return [...changesByGroupId.entries()].flatMap(([groupId, changes]) =>
		createProcessingGroup(groupById.get(groupId), changes)
	);
}

function createProcessingGroup(
	group: InstallationGroupRow | undefined,
	changes: InstallationPendingChangeView[]
) {
	if (!group) return [];

	const doneCount = changes.filter((change) => change.desiredDone).length;

	return [
		{
			id: group.id,
			name: group.name,
			doneCount,
			totalCount: changes.length,
			progressPercent: getInstallationProgressPercent(doneCount, changes.length),
			hasConflicts: changes.some((change) => change.hasConflict),
			changes,
		} satisfies InstallationProcessingGroupView,
	];
}

export async function getActiveInstallationBoardData(): Promise<InstallationBoardData> {
	const db = getDb();
	const snapshot = await getActiveInstallationSnapshot(db);

	if (!snapshot) {
		return {
			snapshot: null,
			columns: createEmptyColumns(),
			processingGroups: [],
		};
	}

	const [groupRows, itemRows, pendingRows] = await Promise.all([
		getInstallationGroupRows(db, snapshot.id),
		getInstallationItemRows(db, snapshot.id),
		getInstallationPendingRows(db, snapshot.id),
	]);

	return {
		snapshot: createSnapshotView(snapshot),
		columns: buildColumns(groupRows, itemRows),
		processingGroups: buildProcessingGroups(groupRows, itemRows, pendingRows),
	};
}
