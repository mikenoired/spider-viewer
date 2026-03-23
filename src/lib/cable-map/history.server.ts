import {
	Document,
	Packer,
	Paragraph,
	Table,
	TableCell,
	TableLayoutType,
	TableRow,
	TextRun,
	WidthType,
} from "docx"
import { and, eq, inArray } from "drizzle-orm"
import type { AuthSession } from "@/lib/auth/shared"
import { getDb } from "@/lib/db"
import { changeAuditLogs, graphGroupRooms, graphGroups, importSnapshots } from "@/lib/db/schema"
import { getRedis } from "@/lib/redis"
import { getHistoryEntries } from "./queries.server"
import { getTodayIsoInMoscow } from "./report-utils"
import type { DateRangeInput, HistoryEntryView, SaveRoomProgressInput } from "./shared"

const historyTableColumnWidths = [1700, 1400, 1600, 2800, 900, 900] as const
const historyReportTableColumnWidths = [1700, 1400, 1600, 2400, 900, 900, 1200] as const

function getTodayInMoscow() {
	return new Intl.DateTimeFormat("ru-RU", {
		timeZone: "Europe/Moscow",
	}).format(new Date())
}

function getTimestampLabel(value: string) {
	return new Intl.DateTimeFormat("ru-RU", {
		timeZone: "Europe/Moscow",
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value))
}

function getDateLabel(value: string) {
	return new Intl.DateTimeFormat("ru-RU", {
		timeZone: "Europe/Moscow",
		day: "numeric",
		month: "long",
		year: "numeric",
	}).format(new Date(value))
}

function getEffectiveDate(value?: string | null) {
	return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : getTodayInMoscow()
}

function createRangeLabel(range?: DateRangeInput) {
	if (!range?.from && !range?.to) {
		return null
	}

	if (range?.from && range?.to && range.from === range.to) {
		return getDateLabel(range.from)
	}

	return `${range?.from ? getDateLabel(range.from) : "..."} — ${
		range?.to ? getDateLabel(range.to) : "..."
	}`
}

async function pushAuditEntriesToRedis(entries: HistoryEntryView[]) {
	if (entries.length === 0) return

	const redis = await getRedis()
	const payloads = entries.map(entry => JSON.stringify(entry))

	await redis
		.multi()
		.lPush("spider-viewer:audit", payloads)
		.lTrim("spider-viewer:audit", 0, 999)
		.exec()

	const backdatedPayloads = entries
		.filter(entry => entry.isBackdated)
		.map(entry => JSON.stringify(entry))

	if (backdatedPayloads.length > 0) {
		await redis
			.multi()
			.lPush("spider-viewer:audit:backdated", backdatedPayloads)
			.lTrim("spider-viewer:audit:backdated", 0, 999)
			.exec()
	}
}

export async function saveRoomProgressChanges(input: SaveRoomProgressInput, session: AuthSession) {
	const db = getDb()
	const now = new Date()
	const effectiveDate = getEffectiveDate(input.effectiveDate)
	const isBackdated = effectiveDate !== getTodayInMoscow()

	const [activeSnapshot] = await db
		.select({
			id: importSnapshots.id,
		})
		.from(importSnapshots)
		.where(eq(importSnapshots.isActive, true))
		.limit(1)

	if (!activeSnapshot) {
		throw new Error("Сначала загрузите данные для графа.")
	}

	const [group] = await db
		.select({
			id: graphGroups.id,
			snapshotId: graphGroups.snapshotId,
		})
		.from(graphGroups)
		.where(and(eq(graphGroups.id, input.groupId), eq(graphGroups.snapshotId, activeSnapshot.id)))
		.limit(1)

	if (!group) {
		throw new Error("Группа помещений не найдена в активном снимке.")
	}

	const roomIds = input.rooms.map(room => room.roomId)
	const persistedRooms = await db
		.select({
			id: graphGroupRooms.id,
			roomName: graphGroupRooms.roomName,
			progress: graphGroupRooms.progress,
		})
		.from(graphGroupRooms)
		.where(and(eq(graphGroupRooms.groupId, group.id), inArray(graphGroupRooms.id, roomIds)))

	if (persistedRooms.length !== roomIds.length) {
		throw new Error("Не все помещения найдены для сохранения прогресса.")
	}

	const roomById = new Map(persistedRooms.map(room => [room.id, room]))
	const auditRows = input.rooms
		.map(roomPatch => {
			const persistedRoom = roomById.get(roomPatch.roomId)

			if (!persistedRoom || persistedRoom.progress === roomPatch.progress) {
				return null
			}

			return {
				roomId: roomPatch.roomId,
				roomName: persistedRoom.roomName,
				oldProgress: persistedRoom.progress,
				newProgress: roomPatch.progress,
			}
		})
		.filter((row): row is NonNullable<typeof row> => row !== null)

	if (auditRows.length === 0) {
		return {
			changedCount: 0,
		}
	}

	const historyEntries = await db.transaction(async tx => {
		for (const auditRow of auditRows) {
			await tx
				.update(graphGroupRooms)
				.set({
					progress: auditRow.newProgress,
					effectiveDate,
					updatedByUserId: session.id,
					updatedAt: now,
				})
				.where(eq(graphGroupRooms.id, auditRow.roomId))
		}

		const insertedRows = await tx
			.insert(changeAuditLogs)
			.values(
				auditRows.map(auditRow => ({
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
				}))
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
			})

		return insertedRows.map(
			entry =>
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
					level: null,
					levelOrder: null,
				}) satisfies HistoryEntryView
		)
	})

	await pushAuditEntriesToRedis(historyEntries)

	return {
		changedCount: historyEntries.length,
	}
}

function createTableCell(text: string, width: number) {
	return new TableCell({
		width: {
			size: width,
			type: WidthType.DXA,
		},
		children: [
			new Paragraph({
				children: [new TextRun(text)],
			}),
		],
	})
}

function createHistoryTable(
	entries: HistoryEntryView[],
	options?: {
		includeTypeColumn?: boolean
	}
) {
	const includeTypeColumn = options?.includeTypeColumn ?? false
	const columnWidths = includeTypeColumn ? historyReportTableColumnWidths : historyTableColumnWidths

	return new Table({
		width: {
			size: 100,
			type: WidthType.PERCENTAGE,
		},
		layout: TableLayoutType.FIXED,
		columnWidths,
		rows: [
			new TableRow({
				tableHeader: true,
				children: [
					createTableCell("Дата изменения", columnWidths[0]),
					createTableCell("Дата действия", columnWidths[1]),
					createTableCell("Пользователь", columnWidths[2]),
					createTableCell("Помещение", columnWidths[3]),
					createTableCell("Было", columnWidths[4]),
					createTableCell("Стало", columnWidths[5]),
					...(includeTypeColumn ? [createTableCell("Тип", columnWidths[6])] : []),
				],
			}),
			...entries.map(
				entry =>
					new TableRow({
						children: [
							createTableCell(getTimestampLabel(entry.changedAt), columnWidths[0]),
							createTableCell(entry.effectiveDate, columnWidths[1]),
							createTableCell(entry.userLogin, columnWidths[2]),
							createTableCell(entry.roomName, columnWidths[3]),
							createTableCell(`${entry.oldProgress}%`, columnWidths[4]),
							createTableCell(`${entry.newProgress}%`, columnWidths[5]),
							...(includeTypeColumn
								? [
										createTableCell(
											entry.isBackdated ? "Задним числом" : "Обычное",
											columnWidths[6]
										),
									]
								: []),
						],
					})
			),
		],
	})
}

function groupHistoryEntriesByLevel(entries: HistoryEntryView[]) {
	const groups = new Map<
		string,
		{
			level: string
			levelOrder: number | null
			entries: HistoryEntryView[]
		}
	>()

	for (const entry of entries) {
		const level = entry.level?.trim() || "Неизвестный уровень"
		const existingGroup = groups.get(level) ?? {
			level,
			levelOrder: entry.levelOrder,
			entries: [],
		}

		existingGroup.levelOrder ??= entry.levelOrder
		existingGroup.entries.push(entry)
		groups.set(level, existingGroup)
	}

	return [...groups.values()]
		.map(group => ({
			...group,
			entries: [...group.entries].sort(
				(left, right) => new Date(right.changedAt).getTime() - new Date(left.changedAt).getTime()
			),
		}))
		.sort((left, right) => {
			const leftOrder = left.levelOrder ?? Number.NEGATIVE_INFINITY
			const rightOrder = right.levelOrder ?? Number.NEGATIVE_INFINITY

			if (leftOrder !== rightOrder) {
				return rightOrder - leftOrder
			}

			return left.level.localeCompare(right.level, "ru", {
				numeric: true,
				sensitivity: "base",
			})
		})
}

type CreateHistoryDocxOptions = {
	level?: string | null
	title?: string
	emptyMessage?: string
}

export async function createBackdatedDocx(range?: DateRangeInput) {
	const entries = await getHistoryEntries(range, {
		backdatedOnly: true,
	})
	const rangeLabel = createRangeLabel(range)
	const title = rangeLabel
		? `Отчёт по изменениям задним числом: ${rangeLabel}`
		: "Отчёт по изменениям задним числом"

	const document = new Document({
		sections: [
			{
				children: [
					new Paragraph({
						heading: "Heading1",
						children: [new TextRun(title)],
					}),
					new Paragraph({
						children: [new TextRun(`Сформировано: ${getTimestampLabel(new Date().toISOString())}`)],
					}),
					...(entries.length > 0
						? [createHistoryTable(entries)]
						: [
								new Paragraph({
									children: [
										new TextRun("За выбранный период изменений задним числом не найдено."),
									],
								}),
							]),
				],
			},
		],
	})

	return Packer.toBuffer(document)
}

export async function createHistoryDocx(
	range?: DateRangeInput,
	options: CreateHistoryDocxOptions = {}
) {
	const level = options.level?.trim() || null
	const entries = await getHistoryEntries(range, level ? { level } : {})
	const rangeLabel = createRangeLabel(range)
	const title =
		options.title ??
		(rangeLabel
			? level
				? `Отчёт об изменениях по уровню ${level}: ${rangeLabel}`
				: `Отчёт об изменениях по уровням: ${rangeLabel}`
			: level
				? `Отчёт об изменениях по уровню ${level}`
				: "Отчёт об изменениях по уровням")
	const groups = groupHistoryEntriesByLevel(entries)
	const emptyMessage =
		options.emptyMessage ??
		(level
			? `За выбранный период изменений по уровню ${level} не найдено.`
			: "За выбранный период изменений по уровням не найдено.")
	const summaryText = level
		? `Всего изменений на уровне: ${entries.length}.`
		: `Всего изменений: ${entries.length}. Уровней с изменениями: ${groups.length}.`

	const document = new Document({
		sections: [
			{
				children: [
					new Paragraph({
						heading: "Heading1",
						children: [new TextRun(title)],
					}),
					new Paragraph({
						children: [new TextRun(`Сформировано: ${getTimestampLabel(new Date().toISOString())}`)],
					}),
					new Paragraph({
						children: [new TextRun(summaryText)],
					}),
					...(groups.length > 0
						? groups.flatMap(group => [
								new Paragraph({
									heading: "Heading2",
									children: [
										new TextRun(
											group.level === "Неизвестный уровень" ? group.level : `Уровень ${group.level}`
										),
									],
								}),
								new Paragraph({
									children: [new TextRun(`Изменений на уровне: ${group.entries.length}.`)],
								}),
								createHistoryTable(group.entries, {
									includeTypeColumn: true,
								}),
							])
						: [
								new Paragraph({
									children: [new TextRun(emptyMessage)],
								}),
							]),
				],
			},
		],
	})

	return Packer.toBuffer(document)
}

export async function createDailyHistoryDocx(level?: string | null) {
	const today = getTodayIsoInMoscow()
	const range = {
		from: today,
		to: today,
	} satisfies DateRangeInput
	const levelLabel = level?.trim() || null
	const rangeLabel = createRangeLabel(range) ?? today

	return createHistoryDocx(range, {
		level: levelLabel,
		title: levelLabel
			? `Ежедневный отчёт по уровню ${levelLabel}: ${rangeLabel}`
			: `Ежедневный отчёт по всем уровням: ${rangeLabel}`,
		emptyMessage: levelLabel
			? `За ${rangeLabel} изменений по уровню ${levelLabel} не найдено.`
			: `За ${rangeLabel} изменений по уровням не найдено.`,
	})
}
