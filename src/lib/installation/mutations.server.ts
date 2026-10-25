import { and, eq, inArray, sql } from "drizzle-orm";

import type { AuthSession } from "@/lib/auth/shared";
import { getDb } from "@/lib/db";
import { installationKksItems, installationPendingChanges, installationSnapshots } from "@/lib/db/schema";

import type {
	ApplyInstallationPendingGroupInput,
	SaveInstallationKksInput,
	SubmitInstallationOfflineChangesInput,
} from "./shared";

type DbClient = ReturnType<typeof getDb>;
type PendingChangeRow = Awaited<ReturnType<typeof getPendingChangesByIds>>[number];

async function getActiveSnapshot(db: DbClient, snapshotId: string) {
	const [snapshot] = await db
		.select({
			id: installationSnapshots.id,
		})
		.from(installationSnapshots)
		.where(and(eq(installationSnapshots.id, snapshotId), eq(installationSnapshots.isActive, true)))
		.limit(1);

	return snapshot ?? null;
}

async function getInstallationItem(db: DbClient, input: SaveInstallationKksInput) {
	const [item] = await db
		.select({
			id: installationKksItems.id,
			revision: installationKksItems.revision,
		})
		.from(installationKksItems)
		.where(
			and(
				eq(installationKksItems.id, input.kksItemId),
				eq(installationKksItems.groupId, input.groupId),
				eq(installationKksItems.snapshotId, input.snapshotId)
			)
		)
		.limit(1);

	return item ?? null;
}

export async function saveInstallationKksState(input: SaveInstallationKksInput, session: AuthSession) {
	const db = getDb();
	const snapshot = await getActiveSnapshot(db, input.snapshotId);

	if (!snapshot) {
		throw new Error("Активный набор данных монтажа не найден.");
	}

	const item = await getInstallationItem(db, input);

	if (!item) {
		throw new Error("KKS не найден в активном наборе данных монтажа.");
	}

	if (item.revision !== input.baseRevision) {
		throw new Error("Данные KKS изменились. Обновите доску и повторите действие.");
	}

	const [updatedItem] = await db
		.update(installationKksItems)
		.set({
			isDone: input.isDone,
			revision: sql`${installationKksItems.revision} + 1`,
			updatedByUserId: session.id,
			updatedAt: new Date(),
		})
		.where(
			and(eq(installationKksItems.id, input.kksItemId), eq(installationKksItems.revision, input.baseRevision))
		)
		.returning({
			id: installationKksItems.id,
			revision: installationKksItems.revision,
		});

	if (!updatedItem) throw new Error("Данные KKS изменились. Обновите доску и повторите действие.");
	return {
		kksItemId: updatedItem.id,
		revision: updatedItem.revision,
	};
}

async function getCurrentItems(db: DbClient, snapshotId: string, itemIds: string[]) {
	return db
		.select({
			id: installationKksItems.id,
			groupId: installationKksItems.groupId,
			isDone: installationKksItems.isDone,
		})
		.from(installationKksItems)
		.where(and(eq(installationKksItems.snapshotId, snapshotId), inArray(installationKksItems.id, itemIds)));
}

function buildPendingChangeRows(
	input: SubmitInstallationOfflineChangesInput,
	session: AuthSession,
	currentDoneByItemId: Map<string, boolean>
) {
	return input.changes.flatMap((change) => {
		const serverDone = currentDoneByItemId.get(change.kksItemId);

		if (serverDone === undefined) return [];

		return [
			{
				clientMutationId: change.clientMutationId,
				snapshotId: input.snapshotId,
				groupId: change.groupId,
				kksItemId: change.kksItemId,
				userId: session.id,
				userLogin: session.login,
				baseDone: change.baseDone,
				desiredDone: change.desiredDone,
				serverDone,
				hasConflict: serverDone !== change.baseDone,
				status: "pending" as const,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		];
	});
}

export async function submitInstallationOfflineChanges(
	input: SubmitInstallationOfflineChangesInput,
	session: AuthSession
) {
	if (input.userId !== session.id)
		throw new Error("Аккаунт изменился. Войдите под автором офлайн-изменений.");
	const db = getDb();
	const snapshot = await getActiveSnapshot(db, input.snapshotId);

	if (!snapshot) {
		throw new Error("Активный набор данных монтажа не найден.");
	}

	const itemIds = [...new Set(input.changes.map((change) => change.kksItemId))];
	const currentItems = await getCurrentItems(db, input.snapshotId, itemIds);

	if (currentItems.length !== itemIds.length) {
		throw new Error("Не все KKS найдены для обработки офлайн-изменений.");
	}

	const currentItemById = new Map(currentItems.map((item) => [item.id, item]));
	if (input.changes.some((change) => currentItemById.get(change.kksItemId)?.groupId !== change.groupId)) {
		throw new Error("KKS относится к другой группе.");
	}
	const currentDoneByItemId = new Map(currentItems.map((item) => [item.id, item.isDone]));
	const rows = buildPendingChangeRows(input, session, currentDoneByItemId);

	if (rows.length === 0) return { queuedCount: 0 };

	await db.transaction(async (tx) => {
		for (let start = 0; start < rows.length; start += 500) {
			await tx
				.insert(installationPendingChanges)
				.values(rows.slice(start, start + 500))
				.onConflictDoNothing({
					target: installationPendingChanges.clientMutationId,
				});
		}
	});

	return {
		queuedCount: rows.length,
	};
}

async function getPendingChangesByIds(
	db: DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0],
	ids: string[]
) {
	return db
		.select({
			id: installationPendingChanges.id,
			groupId: installationPendingChanges.groupId,
			kksItemId: installationPendingChanges.kksItemId,
			snapshotId: installationPendingChanges.snapshotId,
		})
		.from(installationPendingChanges)
		.where(and(eq(installationPendingChanges.status, "pending"), inArray(installationPendingChanges.id, ids)))
		.orderBy(installationPendingChanges.id)
		.for("update");
}

function validatePendingChanges(groupId: string, pendingChanges: PendingChangeRow[], requestedIds: string[]) {
	if (pendingChanges.length !== requestedIds.length) {
		throw new Error("Не все изменения в обработке найдены.");
	}

	if (pendingChanges.some((change) => change.groupId !== groupId)) {
		throw new Error("Изменения относятся к разным группам KKS.");
	}
}

export async function applyInstallationPendingGroup(
	input: ApplyInstallationPendingGroupInput,
	session: AuthSession
) {
	const db = getDb();
	const requestedIds = input.changes.map((change) => change.pendingChangeId);
	const finalDoneByPendingId = new Map(
		input.changes.map((change) => [change.pendingChangeId, change.resolvedDone])
	);
	const requestedById = new Map(input.changes.map((change) => [change.pendingChangeId, change]));
	await db.transaction(async (tx) => {
		const pendingChanges = await getPendingChangesByIds(tx, requestedIds);
		validatePendingChanges(input.groupId, pendingChanges, requestedIds);
		const snapshotIds = [...new Set(pendingChanges.map((change) => change.snapshotId))];
		const [snapshot] =
			snapshotIds.length === 1
				? await tx
						.select({ id: installationSnapshots.id })
						.from(installationSnapshots)
						.where(
							and(eq(installationSnapshots.id, snapshotIds[0]), eq(installationSnapshots.isActive, true))
						)
						.for("share")
				: [];
		if (!snapshot) throw new Error("Набор данных монтажа уже заменен.");
		const appliedByItem = new Map<string, { revision: number; done: boolean }>();
		for (const pendingChange of pendingChanges) {
			const requested = requestedById.get(pendingChange.id)!;
			const applied = appliedByItem.get(pendingChange.kksItemId);
			if (
				applied &&
				(applied.revision !== requested.baseRevision || applied.done !== requested.resolvedDone)
			) {
				throw new Error("Для одного KKS выбраны разные итоговые состояния. Согласуйте изменения.");
			}
			await applyPendingChange(
				tx,
				pendingChange,
				finalDoneByPendingId,
				session,
				requested.baseRevision,
				Boolean(applied)
			);
			appliedByItem.set(pendingChange.kksItemId, {
				revision: requested.baseRevision,
				done: requested.resolvedDone,
			});
		}
	});
	return { appliedCount: requestedIds.length };
}

async function applyPendingChange(
	tx: Parameters<Parameters<DbClient["transaction"]>[0]>[0],
	pendingChange: PendingChangeRow,
	finalDoneByPendingId: Map<string, boolean>,
	session: AuthSession,
	baseRevision: number,
	skipItemUpdate: boolean
) {
	const finalDone = finalDoneByPendingId.get(pendingChange.id);

	if (finalDone === undefined) {
		throw new Error("Для изменения не выбран итоговый статус.");
	}

	if (!skipItemUpdate) {
		const [updated] = await tx
			.update(installationKksItems)
			.set({
				isDone: finalDone,
				revision: sql`${installationKksItems.revision} + 1`,
				updatedByUserId: session.id,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(installationKksItems.id, pendingChange.kksItemId),
					eq(installationKksItems.revision, baseRevision)
				)
			)
			.returning({ id: installationKksItems.id });
		if (!updated) throw new Error("Данные KKS изменились. Обновите доску и повторно решите конфликт.");
	}
	await tx
		.update(installationPendingChanges)
		.set({
			resolvedDone: finalDone,
			status: "applied",
			updatedAt: new Date(),
		})
		.where(eq(installationPendingChanges.id, pendingChange.id));
}
