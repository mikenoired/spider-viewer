import { and, eq } from "drizzle-orm";

import type { AuthSession } from "@/lib/auth/shared";
import { getDb } from "@/lib/db";
import { graphGroupRooms, importSnapshots, priorityRoomKanbanStates, users } from "@/lib/db/schema";

import type { UpdatePriorityRoomKanbanStatusInput } from "./shared";

async function getActiveInstallationSnapshotId() {
	const db = getDb();
	const [snapshot] = await db
		.select({
			id: importSnapshots.id,
		})
		.from(importSnapshots)
		.where(and(eq(importSnapshots.isActive, true), eq(importSnapshots.snapshotKind, "installation")))
		.limit(1);

	return snapshot?.id ?? null;
}

export async function updatePriorityRoomKanbanState(
	input: UpdatePriorityRoomKanbanStatusInput,
	session: AuthSession
) {
	const db = getDb();
	const snapshotId = await getActiveInstallationSnapshotId();

	if (!snapshotId) {
		throw new Error("Активная карта монтажа не найдена.");
	}

	const [room] = await db
		.select({
			id: graphGroupRooms.id,
			snapshotId: graphGroupRooms.snapshotId,
		})
		.from(graphGroupRooms)
		.where(and(eq(graphGroupRooms.id, input.roomId), eq(graphGroupRooms.snapshotId, snapshotId)))
		.limit(1);

	if (!room) {
		throw new Error("Помещение не найдено в активной карте монтажа.");
	}

	const [currentState] = await db
		.select({
			status: priorityRoomKanbanStates.status,
		})
		.from(priorityRoomKanbanStates)
		.where(
			and(
				eq(priorityRoomKanbanStates.snapshotId, snapshotId),
				eq(priorityRoomKanbanStates.roomId, input.roomId)
			)
		)
		.limit(1);

	if (input.status === "checked") {
		if (session.role !== "super-admin") {
			throw new Error("Только супер-админ может подтверждать проверенные помещения.");
		}

		if ((currentState?.status ?? "in_progress") !== "done") {
			throw new Error('В "Проверено" можно перенести только помещение из колонки "Выполнено".');
		}
	}

	if (currentState?.status === "checked" && input.status !== "checked") {
		throw new Error("Проверенное помещение уже подтверждено супер-админом.");
	}

	const now = new Date();
	const nextValues = {
		status: input.status,
		updatedByUserId: session.id,
		checkedByUserId: input.status === "checked" ? session.id : null,
		checkedAt: input.status === "checked" ? now : null,
		updatedAt: now,
	};

	const [updatedState] = await db
		.insert(priorityRoomKanbanStates)
		.values({
			snapshotId,
			roomId: input.roomId,
			...nextValues,
			createdAt: now,
		})
		.onConflictDoUpdate({
			target: [priorityRoomKanbanStates.snapshotId, priorityRoomKanbanStates.roomId],
			set: nextValues,
		})
		.returning({
			roomId: priorityRoomKanbanStates.roomId,
			status: priorityRoomKanbanStates.status,
			updatedAt: priorityRoomKanbanStates.updatedAt,
			checkedAt: priorityRoomKanbanStates.checkedAt,
		});

	const [updatedBy] = await db
		.select({
			login: users.login,
		})
		.from(users)
		.where(eq(users.id, session.id))
		.limit(1);

	return {
		roomId: updatedState.roomId,
		status: updatedState.status,
		updatedAt: updatedState.updatedAt.toISOString(),
		updatedByLogin: updatedBy?.login ?? session.login,
		checkedAt: updatedState.checkedAt?.toISOString() ?? null,
		checkedByLogin: updatedState.status === "checked" ? (updatedBy?.login ?? session.login) : null,
	};
}
