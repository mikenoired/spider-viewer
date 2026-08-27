import { and, desc, eq, inArray } from "drizzle-orm";

import type { AuthSession } from "@/lib/auth/shared";
import { getDb } from "@/lib/db";
import {
	cableChangeAuditLogs,
	changeAuditLogs,
	importSnapshots,
	priorityRoomLists,
	remarks,
	users,
} from "@/lib/db/schema";

import type { CreateRemarkInput, RemarksData, UpdateRemarkStatusInput } from "./shared";

function toIso(value: Date | null) {
	return value?.toISOString() ?? null;
}

async function getUserLogins(ids: string[]) {
	const uniqueIds = [...new Set(ids.filter(Boolean))];
	if (uniqueIds.length === 0) return new Map<string, string>();

	const db = getDb();
	const rows = await db
		.select({ id: users.id, login: users.login })
		.from(users)
		.where(inArray(users.id, uniqueIds));
	return new Map(rows.map((row) => [row.id, row.login]));
}

export async function getRemarksData(): Promise<RemarksData> {
	const db = getDb();
	const [cableChanges, roomChanges, lists, rows] = await Promise.all([
		db
			.select({
				id: cableChangeAuditLogs.id,
				cableLabel: cableChangeAuditLogs.cableLabel,
				roomName: cableChangeAuditLogs.roomName,
				oldProgress: cableChangeAuditLogs.oldProgress,
				newProgress: cableChangeAuditLogs.newProgress,
				changedAt: cableChangeAuditLogs.changedAt,
				userLogin: cableChangeAuditLogs.userLogin,
			})
			.from(cableChangeAuditLogs)
			.orderBy(desc(cableChangeAuditLogs.changedAt))
			.limit(40),
		db
			.select({
				id: changeAuditLogs.id,
				roomName: changeAuditLogs.roomName,
				oldProgress: changeAuditLogs.oldProgress,
				newProgress: changeAuditLogs.newProgress,
				changedAt: changeAuditLogs.changedAt,
				userLogin: changeAuditLogs.userLogin,
			})
			.from(changeAuditLogs)
			.orderBy(desc(changeAuditLogs.changedAt))
			.limit(40),
		db
			.select({
				id: priorityRoomLists.id,
				authorName: priorityRoomLists.authorName,
				fileName: priorityRoomLists.fileName,
			})
			.from(priorityRoomLists)
			.innerJoin(
				importSnapshots,
				and(
					eq(importSnapshots.id, priorityRoomLists.snapshotId),
					eq(importSnapshots.isActive, true),
					eq(importSnapshots.snapshotKind, "installation")
				)
			)
			.orderBy(desc(priorityRoomLists.createdAt)),
		db.select().from(remarks).orderBy(desc(remarks.createdAt)).limit(100),
	]);

	const targets = [
		...cableChanges.map((change) => ({
			type: "cable_change" as const,
			id: change.id,
			label: `Кабель ${change.cableLabel}`,
			details: `${change.roomName}: ${change.oldProgress}% → ${change.newProgress}% · ${change.userLogin}`,
		})),
		...roomChanges.map((change) => ({
			type: "room_change" as const,
			id: change.id,
			label: `Работы в помещении ${change.roomName}`,
			details: `${change.oldProgress}% → ${change.newProgress}% · ${change.userLogin}`,
		})),
		...lists.map((list) => ({
			type: "priority_list" as const,
			id: list.id,
			label: `Список ${list.authorName}`,
			details: list.fileName,
		})),
	];
	const labelsByTarget = new Map(targets.map((target) => [`${target.type}:${target.id}`, target.label]));
	const userLogins = await getUserLogins(
		rows.flatMap((row) => [row.createdByUserId, row.resolvedByUserId ?? ""])
	);

	return {
		targets,
		remarks: rows.map((row) => ({
			id: row.id,
			targetType: row.targetType,
			targetId: row.targetId,
			targetLabel: labelsByTarget.get(`${row.targetType}:${row.targetId}`) ?? "Исходная запись недоступна",
			content: row.content,
			status: row.status,
			createdAt: row.createdAt.toISOString(),
			createdByLogin: userLogins.get(row.createdByUserId) ?? "Неизвестный пользователь",
			resolvedAt: toIso(row.resolvedAt),
			resolvedByLogin: row.resolvedByUserId ? (userLogins.get(row.resolvedByUserId) ?? null) : null,
		})),
	};
}

async function targetExists(input: CreateRemarkInput) {
	const db = getDb();
	const table =
		input.targetType === "cable_change"
			? cableChangeAuditLogs
			: input.targetType === "room_change"
				? changeAuditLogs
				: priorityRoomLists;
	const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, input.targetId)).limit(1);
	return Boolean(row);
}

export async function createRemark(input: CreateRemarkInput, session: AuthSession) {
	if (!(await targetExists(input))) throw new Error("Запись для замечания не найдена.");

	const db = getDb();
	const now = new Date();
	const [remark] = await db
		.insert(remarks)
		.values({ ...input, createdByUserId: session.id, createdAt: now, updatedAt: now })
		.returning({ id: remarks.id });
	return remark;
}

export async function updateRemarkStatus(input: UpdateRemarkStatusInput, session: AuthSession) {
	const db = getDb();
	const now = new Date();
	const [remark] = await db
		.update(remarks)
		.set({
			status: input.status,
			resolvedByUserId: input.status === "resolved" ? session.id : null,
			resolvedAt: input.status === "resolved" ? now : null,
			updatedAt: now,
		})
		.where(eq(remarks.id, input.remarkId))
		.returning({ id: remarks.id });
	if (!remark) throw new Error("Замечание не найдено.");
	return remark;
}
