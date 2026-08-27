import { and, eq } from "drizzle-orm";

import type { AuthSession } from "@/lib/auth/shared";
import { getDb } from "@/lib/db";
import { importSnapshots, priorityRoomLists } from "@/lib/db/schema";

import type { UpdatePriorityListKanbanStatusInput } from "./shared";

export async function updatePriorityListKanbanStatus(
	input: UpdatePriorityListKanbanStatusInput,
	session: AuthSession
) {
	const db = getDb();
	const now = new Date();
	const [snapshot] = await db
		.select({ id: importSnapshots.id })
		.from(importSnapshots)
		.where(and(eq(importSnapshots.isActive, true), eq(importSnapshots.snapshotKind, "installation")))
		.limit(1);

	if (!snapshot) {
		throw new Error("Активная карта монтажа не найдена.");
	}

	const [updated] = await db
		.update(priorityRoomLists)
		.set({
			status: input.status,
			statusUpdatedByUserId: session.id,
			statusUpdatedAt: now,
			updatedAt: now,
		})
		.where(and(eq(priorityRoomLists.id, input.listId), eq(priorityRoomLists.snapshotId, snapshot.id)))
		.returning({ id: priorityRoomLists.id, status: priorityRoomLists.status });

	if (!updated) {
		throw new Error("Список не найден в активной карте монтажа.");
	}

	return updated;
}
