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
} from "docx";
import { and, eq, inArray } from "drizzle-orm";

import type { AuthSession } from "@/lib/auth/shared";
import { getDb } from "@/lib/db";
import {
	cableChangeAuditLogs,
	cableProgress,
	graphGroupRooms,
	graphGroups,
	importSnapshots,
	importedCableRows,
} from "@/lib/db/schema";
import { getRedis } from "@/lib/redis";

import { getHistoryEntries } from "./queries.server";
import { getTodayIsoInMoscow } from "./report-utils";
import type { DateRangeInput, HistoryEntryView, SaveCableProgressInput, SnapshotKind } from "./shared";

const historyTableColumnWidths = [1500, 1300, 1400, 2600, 1500, 900, 900, 900] as const;
const historyReportTableColumnWidths = [1500, 1300, 1400, 2400, 1400, 900, 900, 900, 1200] as const;

function getTodayInMoscow() {
	return getTodayIsoInMoscow();
}

function getTimestampLabel(value: string) {
	return new Intl.DateTimeFormat("ru-RU", {
		timeZone: "Europe/Moscow",
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

function getDateLabel(value: string) {
	return new Intl.DateTimeFormat("ru-RU", {
		timeZone: "Europe/Moscow",
		day: "numeric",
		month: "long",
		year: "numeric",
	}).format(new Date(value));
}

function getEffectiveDate(value?: string | null) {
	return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : getTodayInMoscow();
}

function createRangeLabel(range?: DateRangeInput) {
	if (!range?.from && !range?.to) {
		return null;
	}

	if (range?.from && range?.to && range.from === range.to) {
		return getDateLabel(range.from);
	}

	return `${range?.from ? getDateLabel(range.from) : "..."} — ${range?.to ? getDateLabel(range.to) : "..."}`;
}

async function pushAuditEntriesToRedis(entries: HistoryEntryView[]) {
	if (entries.length === 0) return;

	const redis = await getRedis();
	const payloads = entries.map((entry) => JSON.stringify(entry));

	await redis.multi().lPush("spider-viewer:audit", payloads).lTrim("spider-viewer:audit", 0, 999).exec();

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

export async function saveCableProgressChanges(input: SaveCableProgressInput, session: AuthSession) {
	const db = getDb();
	const now = new Date();
	const effectiveDate = getEffectiveDate(input.effectiveDate);
	const isBackdated = effectiveDate !== getTodayInMoscow();

	const [group] = await db
		.select({
			id: graphGroups.id,
			snapshotId: graphGroups.snapshotId,
			groupKey: graphGroups.groupKey,
		})
		.from(graphGroups)
		.innerJoin(importSnapshots, eq(importSnapshots.id, graphGroups.snapshotId))
		.where(and(eq(graphGroups.id, input.groupId), eq(importSnapshots.isActive, true)))
		.limit(1);

	if (!group) {
		throw new Error("Группа помещений не найдена в активном снимке.");
	}

	const roomIds = [...new Set(input.cables.map((cable) => cable.roomId))];
	const persistedRooms = await db
		.select({
			id: graphGroupRooms.id,
			roomName: graphGroupRooms.roomName,
		})
		.from(graphGroupRooms)
		.where(and(eq(graphGroupRooms.groupId, group.id), inArray(graphGroupRooms.id, roomIds)));

	if (persistedRooms.length !== roomIds.length) {
		throw new Error("Не все помещения найдены для сохранения прогресса.");
	}

	const cableIds = [...new Set(input.cables.map((cable) => cable.cableId))];
	const persistedCables = await db
		.select({
			id: importedCableRows.id,
			cableLabel: importedCableRows.cableLabel,
			fromRoom: importedCableRows.fromRoom,
			fromZone: importedCableRows.fromZone,
			level: importedCableRows.level,
			graphSide: importedCableRows.graphSide,
			graphSubzone: importedCableRows.graphSubzone,
			farthestShaft: importedCableRows.farthestShaft,
		})
		.from(importedCableRows)
		.where(and(eq(importedCableRows.snapshotId, group.snapshotId), inArray(importedCableRows.id, cableIds)));

	if (persistedCables.length !== cableIds.length) {
		throw new Error("Не все кабели найдены для сохранения прогресса.");
	}

	const persistedProgressRows = cableIds.length
		? await db
				.select({
					cableRowId: cableProgress.cableRowId,
					progress: cableProgress.progress,
				})
				.from(cableProgress)
				.where(
					and(eq(cableProgress.snapshotId, group.snapshotId), inArray(cableProgress.cableRowId, cableIds))
				)
		: [];

	const roomById = new Map(persistedRooms.map((room) => [room.id, room]));
	const cableById = new Map(persistedCables.map((cable) => [cable.id, cable]));
	const progressByCableId = new Map(
		persistedProgressRows.map((progressRow) => [progressRow.cableRowId, progressRow.progress])
	);
	const auditRows = input.cables
		.map((cablePatch) => {
			const persistedRoom = roomById.get(cablePatch.roomId);
			const persistedCable = cableById.get(cablePatch.cableId);

			if (!persistedRoom || !persistedCable) {
				return null;
			}

			const cableGroupKey = [
				persistedCable.graphSide,
				persistedCable.graphSubzone ?? "none",
				persistedCable.fromZone || "unknown",
				persistedCable.level,
			].join(":");

			if (cableGroupKey !== group.groupKey || persistedCable.fromRoom !== persistedRoom.roomName) {
				throw new Error(`Кабель ${persistedCable.cableLabel} не принадлежит выбранному помещению.`);
			}

			const oldProgress = progressByCableId.get(cablePatch.cableId) ?? 0;

			if (oldProgress === cablePatch.progress) {
				return null;
			}

			return {
				roomId: cablePatch.roomId,
				roomName: persistedRoom.roomName,
				cableRowId: cablePatch.cableId,
				cableLabel: persistedCable.cableLabel,
				shaft: persistedCable.farthestShaft ?? 0,
				oldProgress,
				newProgress: cablePatch.progress,
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
				.insert(cableProgress)
				.values({
					snapshotId: group.snapshotId,
					groupId: group.id,
					roomId: auditRow.roomId,
					cableRowId: auditRow.cableRowId,
					progress: auditRow.newProgress,
					effectiveDate,
					updatedByUserId: session.id,
					updatedAt: now,
					createdAt: now,
				})
				.onConflictDoUpdate({
					target: [cableProgress.snapshotId, cableProgress.cableRowId],
					set: {
						groupId: group.id,
						roomId: auditRow.roomId,
						progress: auditRow.newProgress,
						effectiveDate,
						updatedByUserId: session.id,
						updatedAt: now,
					},
				});
		}

		const insertedRows = await tx
			.insert(cableChangeAuditLogs)
			.values(
				auditRows.map((auditRow) => ({
					snapshotId: group.snapshotId,
					groupId: group.id,
					roomId: auditRow.roomId,
					cableRowId: auditRow.cableRowId,
					roomName: auditRow.roomName,
					cableLabel: auditRow.cableLabel,
					shaft: auditRow.shaft,
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
			});

		return insertedRows.map(
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
					changedAt: entry.changedAt.toISOString(),
					effectiveDate: entry.effectiveDate,
					isBackdated: entry.isBackdated,
					groupId: entry.groupId,
					level: null,
					levelOrder: null,
				}) satisfies HistoryEntryView
		);
	});

	await pushAuditEntriesToRedis(historyEntries);

	return {
		changedCount: historyEntries.length,
	};
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
	});
}

function createHistoryTable(
	entries: HistoryEntryView[],
	options?: {
		includeTypeColumn?: boolean;
	}
) {
	const includeTypeColumn = options?.includeTypeColumn ?? false;
	const columnWidths = includeTypeColumn ? historyReportTableColumnWidths : historyTableColumnWidths;
	const typeColumnWidth = historyReportTableColumnWidths[8];

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
					createTableCell("Кабель", columnWidths[3]),
					createTableCell("Помещение", columnWidths[4]),
					createTableCell("КШ", columnWidths[5]),
					createTableCell("Было", columnWidths[6]),
					createTableCell("Стало", columnWidths[7]),
					...(includeTypeColumn ? [createTableCell("Тип", typeColumnWidth)] : []),
				],
			}),
			...entries.map(
				(entry) =>
					new TableRow({
						children: [
							createTableCell(getTimestampLabel(entry.changedAt), columnWidths[0]),
							createTableCell(entry.effectiveDate, columnWidths[1]),
							createTableCell(entry.userLogin, columnWidths[2]),
							createTableCell(entry.cableLabel, columnWidths[3]),
							createTableCell(entry.roomName, columnWidths[4]),
							createTableCell(entry.shaft > 0 ? `КШ ${entry.shaft}` : "Без КШ", columnWidths[5]),
							createTableCell(`${entry.oldProgress}%`, columnWidths[6]),
							createTableCell(`${entry.newProgress}%`, columnWidths[7]),
							...(includeTypeColumn
								? [createTableCell(entry.isBackdated ? "Задним числом" : "Обычное", typeColumnWidth)]
								: []),
						],
					})
			),
		],
	});
}

function groupHistoryEntriesByLevel(entries: HistoryEntryView[]) {
	const groups = new Map<
		string,
		{
			level: string;
			levelOrder: number | null;
			entries: HistoryEntryView[];
		}
	>();

	for (const entry of entries) {
		const level = entry.level?.trim() || "Неизвестный уровень";
		const existingGroup = groups.get(level) ?? {
			level,
			levelOrder: entry.levelOrder,
			entries: [],
		};

		existingGroup.levelOrder ??= entry.levelOrder;
		existingGroup.entries.push(entry);
		groups.set(level, existingGroup);
	}

	return [...groups.values()]
		.map((group) => ({
			...group,
			entries: [...group.entries].sort(
				(left, right) => new Date(right.changedAt).getTime() - new Date(left.changedAt).getTime()
			),
		}))
		.sort((left, right) => {
			const leftOrder = left.levelOrder ?? Number.NEGATIVE_INFINITY;
			const rightOrder = right.levelOrder ?? Number.NEGATIVE_INFINITY;

			if (leftOrder !== rightOrder) {
				return rightOrder - leftOrder;
			}

			return left.level.localeCompare(right.level, "ru", {
				numeric: true,
				sensitivity: "base",
			});
		});
}

type CreateHistoryDocxOptions = {
	level?: string | null;
	snapshotKind?: SnapshotKind;
	title?: string;
	emptyMessage?: string;
};

function createHistoryTitle(rangeLabel: string | null, level: string | null, title?: string) {
	if (title) {
		return title;
	}

	if (rangeLabel) {
		return level
			? `Отчёт об изменениях по уровню ${level}: ${rangeLabel}`
			: `Отчёт об изменениях по уровням: ${rangeLabel}`;
	}

	return level ? `Отчёт об изменениях по уровню ${level}` : "Отчёт об изменениях по уровням";
}

function createHistoryEmptyMessage(level: string | null, emptyMessage?: string) {
	if (emptyMessage) {
		return emptyMessage;
	}

	return level
		? `За выбранный период изменений по уровню ${level} не найдено.`
		: "За выбранный период изменений по уровням не найдено.";
}

function createHistorySummaryText(level: string | null, entryCount: number, groupCount: number) {
	return level
		? `Всего изменений на уровне: ${entryCount}.`
		: `Всего изменений: ${entryCount}. Уровней с изменениями: ${groupCount}.`;
}

function createHistoryGroupSections(groups: ReturnType<typeof groupHistoryEntriesByLevel>) {
	return groups.flatMap((group) => [
		new Paragraph({
			heading: "Heading2",
			children: [new TextRun(group.level === "Неизвестный уровень" ? group.level : `Уровень ${group.level}`)],
		}),
		new Paragraph({
			children: [new TextRun(`Изменений на уровне: ${group.entries.length}.`)],
		}),
		createHistoryTable(group.entries, {
			includeTypeColumn: true,
		}),
	]);
}

function createHistoryDocumentChildren({
	title,
	summaryText,
	groups,
	emptyMessage,
}: {
	title: string;
	summaryText: string;
	groups: ReturnType<typeof groupHistoryEntriesByLevel>;
	emptyMessage: string;
}) {
	return [
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
			? createHistoryGroupSections(groups)
			: [
					new Paragraph({
						children: [new TextRun(emptyMessage)],
					}),
				]),
	];
}

export async function createBackdatedDocx(range?: DateRangeInput) {
	const entries = await getHistoryEntries(range, {
		backdatedOnly: true,
	});
	const rangeLabel = createRangeLabel(range);
	const title = rangeLabel
		? `Отчёт по изменениям задним числом: ${rangeLabel}`
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
						children: [new TextRun(`Сформировано: ${getTimestampLabel(new Date().toISOString())}`)],
					}),
					...(entries.length > 0
						? [createHistoryTable(entries)]
						: [
								new Paragraph({
									children: [new TextRun("За выбранный период изменений задним числом не найдено.")],
								}),
							]),
				],
			},
		],
	});

	return Packer.toBuffer(document);
}

export async function createHistoryDocx(range?: DateRangeInput, options: CreateHistoryDocxOptions = {}) {
	const level = options.level?.trim() || null;
	const entries = await getHistoryEntries(range, {
		...(level ? { level } : {}),
		...(options.snapshotKind ? { snapshotKind: options.snapshotKind } : {}),
	});
	const rangeLabel = createRangeLabel(range);
	const groups = groupHistoryEntriesByLevel(entries);
	const title = createHistoryTitle(rangeLabel, level, options.title);
	const emptyMessage = createHistoryEmptyMessage(level, options.emptyMessage);
	const summaryText = createHistorySummaryText(level, entries.length, groups.length);

	const document = new Document({
		sections: [
			{
				children: createHistoryDocumentChildren({
					title,
					summaryText,
					groups,
					emptyMessage,
				}),
			},
		],
	});

	return Packer.toBuffer(document);
}

export async function createDailyHistoryDocx(
	level?: string | null,
	snapshotKind: SnapshotKind = "demolition"
) {
	const today = getTodayIsoInMoscow();
	const range = {
		from: today,
		to: today,
	} satisfies DateRangeInput;
	const levelLabel = level?.trim() || null;
	const rangeLabel = createRangeLabel(range) ?? today;

	return createHistoryDocx(range, {
		level: levelLabel,
		snapshotKind,
		title: levelLabel
			? `Ежедневный отчёт по уровню ${levelLabel}: ${rangeLabel}`
			: `Ежедневный отчёт по всем уровням: ${rangeLabel}`,
		emptyMessage: levelLabel
			? `За ${rangeLabel} изменений по уровню ${levelLabel} не найдено.`
			: `За ${rangeLabel} изменений по уровням не найдено.`,
	});
}
