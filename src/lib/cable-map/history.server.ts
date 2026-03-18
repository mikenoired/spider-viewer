import {
	Document,
	Packer,
	Paragraph,
	Table,
	TableCell,
	TableRow,
	TextRun,
	WidthType,
} from "docx";
import { and, eq, inArray } from "drizzle-orm";
import type { AuthSession } from "@/lib/auth/shared";
import { getDb } from "@/lib/db";
import {
	changeAuditLogs,
	graphGroupRooms,
	graphGroups,
	importSnapshots,
} from "@/lib/db/schema";
import { getRedis } from "@/lib/redis";
import { getHistoryEntries } from "./queries.server";
import type {
	DateRangeInput,
	HistoryEntryView,
	SaveRoomProgressInput,
} from "./shared";

function getTodayInMoscow() {
	return new Intl.DateTimeFormat("sv-SE", {
		timeZone: "Europe/Moscow",
	}).format(new Date());
}

function getTimestampLabel(value: string) {
	return new Intl.DateTimeFormat("ru-RU", {
		timeZone: "Europe/Moscow",
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

function getEffectiveDate(value?: string | null) {
	return value && /^\d{4}-\d{2}-\d{2}$/.test(value)
		? value
		: getTodayInMoscow();
}

async function pushAuditEntriesToRedis(entries: HistoryEntryView[]) {
	if (entries.length === 0) {
		return;
	}

	const redis = await getRedis();
	const payloads = entries.map((entry) => JSON.stringify(entry));

	await redis
		.multi()
		.lPush("spider-viewer:audit", payloads)
		.lTrim("spider-viewer:audit", 0, 999)
		.exec();

	const backdatedPayloads = entries
		.filter((entry) => entry.isBackdated)
		.map((entry) => JSON.stringify(entry));

	if (backdatedPayloads.length > 0) {
		await redis
			.multi()
			.lPush("spider-viewer:audit:backdated", backdatedPayloads)
			.lTrim("spider-viewer:audit:backdated", 0, 999)
			.exec();
	}
}

export async function saveRoomProgressChanges(
	input: SaveRoomProgressInput,
	session: AuthSession,
) {
	const db = getDb();
	const now = new Date();
	const effectiveDate = getEffectiveDate(input.effectiveDate);
	const isBackdated = effectiveDate !== getTodayInMoscow();

	const [activeSnapshot] = await db
		.select({
			id: importSnapshots.id,
		})
		.from(importSnapshots)
		.where(eq(importSnapshots.isActive, true))
		.limit(1);

	if (!activeSnapshot) {
		throw new Error("Сначала загрузите данные для графа.");
	}

	const [group] = await db
		.select({
			id: graphGroups.id,
			snapshotId: graphGroups.snapshotId,
		})
		.from(graphGroups)
		.where(
			and(
				eq(graphGroups.id, input.groupId),
				eq(graphGroups.snapshotId, activeSnapshot.id),
			),
		)
		.limit(1);

	if (!group) {
		throw new Error("Группа помещений не найдена в активном снимке.");
	}

	const roomIds = input.rooms.map((room) => room.roomId);
	const persistedRooms = await db
		.select({
			id: graphGroupRooms.id,
			roomName: graphGroupRooms.roomName,
			progress: graphGroupRooms.progress,
		})
		.from(graphGroupRooms)
		.where(
			and(
				eq(graphGroupRooms.groupId, group.id),
				inArray(graphGroupRooms.id, roomIds),
			),
		);

	if (persistedRooms.length !== roomIds.length) {
		throw new Error("Не все помещения найдены для сохранения прогресса.");
	}

	const roomById = new Map(persistedRooms.map((room) => [room.id, room]));
	const auditRows = input.rooms
		.map((roomPatch) => {
			const persistedRoom = roomById.get(roomPatch.roomId);

			if (!persistedRoom || persistedRoom.progress === roomPatch.progress) {
				return null;
			}

			return {
				roomId: roomPatch.roomId,
				roomName: persistedRoom.roomName,
				oldProgress: persistedRoom.progress,
				newProgress: roomPatch.progress,
			};
		})
		.filter((row): row is NonNullable<typeof row> => row !== null);

	if (auditRows.length === 0) {
		return {
			changedCount: 0,
		};
	}

	const historyEntries = await db.transaction(async (tx) => {
		for (const auditRow of auditRows) {
			await tx
				.update(graphGroupRooms)
				.set({
					progress: auditRow.newProgress,
					effectiveDate,
					updatedByUserId: session.id,
					updatedAt: now,
				})
				.where(eq(graphGroupRooms.id, auditRow.roomId));
		}

		const insertedRows = await tx
			.insert(changeAuditLogs)
			.values(
				auditRows.map((auditRow) => ({
					snapshotId: activeSnapshot.id,
					groupId: group.id,
					roomId: auditRow.roomId,
					roomName: auditRow.roomName,
					userId: session.id,
					userLogin: session.login,
					changedAt: now,
					effectiveDate,
					isBackdated,
					oldProgress: auditRow.oldProgress,
					newProgress: auditRow.newProgress,
					createdAt: now,
				})),
			)
			.returning({
				id: changeAuditLogs.id,
				roomName: changeAuditLogs.roomName,
				userLogin: changeAuditLogs.userLogin,
				oldProgress: changeAuditLogs.oldProgress,
				newProgress: changeAuditLogs.newProgress,
				changedAt: changeAuditLogs.changedAt,
				effectiveDate: changeAuditLogs.effectiveDate,
				isBackdated: changeAuditLogs.isBackdated,
				groupId: changeAuditLogs.groupId,
			});

		return insertedRows.map(
			(entry) =>
				({
					id: entry.id,
					roomName: entry.roomName,
					userLogin: entry.userLogin,
					oldProgress: entry.oldProgress,
					newProgress: entry.newProgress,
					changedAt: entry.changedAt.toISOString(),
					effectiveDate: entry.effectiveDate,
					isBackdated: entry.isBackdated,
					groupId: entry.groupId,
				}) satisfies HistoryEntryView,
		);
	});

	await pushAuditEntriesToRedis(historyEntries);

	return {
		changedCount: historyEntries.length,
	};
}

function createTableCell(text: string) {
	return new TableCell({
		width: {
			size: 20,
			type: WidthType.PERCENTAGE,
		},
		children: [
			new Paragraph({
				children: [new TextRun(text)],
			}),
		],
	});
}

function createHistoryTable(entries: HistoryEntryView[]) {
	return new Table({
		width: {
			size: 100,
			type: WidthType.PERCENTAGE,
		},
		rows: [
			new TableRow({
				tableHeader: true,
				children: [
					createTableCell("Дата изменения"),
					createTableCell("Дата действия"),
					createTableCell("Пользователь"),
					createTableCell("Помещение"),
					createTableCell("Было"),
					createTableCell("Стало"),
				],
			}),
			...entries.map(
				(entry) =>
					new TableRow({
						children: [
							createTableCell(getTimestampLabel(entry.changedAt)),
							createTableCell(entry.effectiveDate),
							createTableCell(entry.userLogin),
							createTableCell(entry.roomName),
							createTableCell(`${entry.oldProgress}%`),
							createTableCell(`${entry.newProgress}%`),
						],
					}),
			),
		],
	});
}

export async function createBackdatedDocx(range?: DateRangeInput) {
	const entries = await getHistoryEntries(range, true);
	const title =
		range?.from || range?.to
			? `Отчёт по изменениям задним числом: ${range?.from ?? "..."} — ${range?.to ?? "..."}`
			: "Отчёт по изменениям задним числом";

	const document = new Document({
		sections: [
			{
				children: [
					new Paragraph({
						heading: "Heading1",
						children: [new TextRun(title)],
					}),
					new Paragraph({
						children: [
							new TextRun(
								`Сформировано: ${getTimestampLabel(new Date().toISOString())}`,
							),
						],
					}),
					...(entries.length > 0
						? [createHistoryTable(entries)]
						: [
								new Paragraph({
									children: [
										new TextRun(
											"За выбранный период изменений задним числом не найдено.",
										),
									],
								}),
							]),
				],
			},
		],
	});

	return Packer.toBuffer(document);
}
