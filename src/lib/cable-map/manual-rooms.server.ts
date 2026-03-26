import { eq } from "drizzle-orm";

import type { AuthSession } from "@/lib/auth/shared";
import type { CreateManualRoomInput, DeleteManualRoomInput } from "@/lib/cable-map/shared";
import { getDb } from "@/lib/db";
import { graphGroups, manualGraphRooms } from "@/lib/db/schema";

export async function createManualGroupRoom(input: CreateManualRoomInput, session: AuthSession) {
	const db = getDb();
	const roomName = input.roomName.trim();
	const [group] = await db
		.select({
			id: graphGroups.id,
			sourceZone: graphGroups.sourceZone,
			level: graphGroups.level,
		})
		.from(graphGroups)
		.where(eq(graphGroups.id, input.groupId))
		.limit(1);

	if (!group) throw new Error("Группа для ручного помещения не найдена.");

	const now = new Date();
	const [createdRoom] = await db
		.insert(manualGraphRooms)
		.values({
			roomName,
			sourceZone: group.sourceZone,
			level: group.level,
			createdByUserId: session.id,
			updatedAt: now,
			createdAt: now,
		})
		.onConflictDoNothing()
		.returning({
			id: manualGraphRooms.id,
			roomName: manualGraphRooms.roomName,
			sourceZone: manualGraphRooms.sourceZone,
			level: manualGraphRooms.level,
		});

	if (!createdRoom) {
		throw new Error("Такое помещение уже добавлено для этой зоны и отметки.");
	}

	return createdRoom;
}

export async function deleteManualGroupRoom(input: DeleteManualRoomInput, _session: AuthSession) {
	const db = getDb();
	const [deletedRoom] = await db
		.delete(manualGraphRooms)
		.where(eq(manualGraphRooms.id, input.roomId))
		.returning({
			id: manualGraphRooms.id,
			roomName: manualGraphRooms.roomName,
		});

	if (!deletedRoom) throw new Error("Ручное помещение не найдено.");

	return deletedRoom;
}
