import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import type { AuthSession } from "@/lib/auth/shared";
import { getDb } from "@/lib/db";
import {
	graphGroupRooms,
	graphGroups,
	type graphSideEnum,
	type graphSubzoneEnum,
	importedCableRows,
	importSnapshots,
} from "@/lib/db/schema";
import { enToRuVisual } from "@/lib/utils";
import { supportedWorkbookExtensions } from "./shared";

type GraphSide = (typeof graphSideEnum.enumValues)[number];
type GraphSubzone = (typeof graphSubzoneEnum.enumValues)[number] | null;

type ParsedCableRow = {
	sourceRowIndex: number;
	cableLabel: string;
	cableJournal: string;
	cableNumber: string;
	repeatFrom: string;
	repeatTo: string;
	repeatKks: string;
	fromRoom: string;
	fromLocation: string;
	fromEquipment: string;
	toRoom: string;
	threadLength: number;
	threadCount: number;
	totalLength: number;
	level: string;
	levelOrder: number;
	fromZone: string;
	toZone: string;
	graphSide: GraphSide;
	graphSubzone: GraphSubzone;
	farthestShaft: number | null;
	shaftValues: Array<{
		column: number;
		label: string;
		value: string;
		shaft: number;
	}>;
	route: string;
	rawRow: string[];
};

type AggregatedRoom = {
	roomName: string;
	roomRole: "primary" | "secondary";
	cableCount: number;
	threadCount: number;
	totalLength: number;
	sortOrder: number;
};

type AggregatedGroup = {
	groupKey: string;
	graphSide: GraphSide;
	graphSubzone: GraphSubzone;
	sourceZone: string;
	level: string;
	levelOrder: number;
	primaryRooms: Map<string, AggregatedRoom>;
	secondaryRooms: Map<string, AggregatedRoom>;
	cableCount: number;
	threadCount: number;
	totalLength: number;
	bucketThreads: Record<0 | 1 | 2 | 3 | 4, number>;
};

const workbookColumnIndexes = {
	cableLabel: 0,
	cableJournal: 1,
	cableNumber: 2,
	repeatFrom: 3,
	repeatTo: 4,
	repeatKks: 5,
	fromRoom: 7,
	fromLocation: 8,
	fromEquipment: 9,
	toRoom: 10,
	threadLength: 11,
	threadCount: 12,
	totalLength: 13,
	level: 14,
	fromZone: 15,
	toZone: 16,
	route: 31,
} as const;

function getTodayInMoscow() {
	return new Intl.DateTimeFormat("sv-SE", {
		timeZone: "Europe/Moscow",
	}).format(new Date());
}

function normalizeCellValue(value: unknown) {
	return String(value ?? "").trim();
}

function parseLocaleNumber(value: string) {
	const normalized = value.replaceAll(" ", "").replace(",", ".");
	const parsed = Number(normalized);

	return Number.isFinite(parsed) ? parsed : 0;
}

function parseInteger(value: string) {
	return Math.round(parseLocaleNumber(value));
}

function getWorkbookExtension(fileName: string) {
	return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function resolveGraphSide(fromZone: string): GraphSide {
	return fromZone === "ЧЗ" ? "clean" : "dirty";
}

function resolveGraphSubzone(
	fromZone: string,
	graphSide: GraphSide,
): GraphSubzone {
	if (graphSide === "clean") {
		return "clean";
	}

	return fromZone === "ГЗ" ? "dirty" : "clean";
}

function isMeaningfulValue(value: string) {
	return value !== "" && value !== "0" && value !== "#Н/Д";
}

function sortRoomNames(values: Iterable<string>) {
	return [...values].sort((left, right) =>
		left.localeCompare(right, "ru", {
			numeric: true,
			sensitivity: "base",
		}),
	);
}

function extractShaftValues(row: string[], headerRow: string[]) {
	const shaftValues: ParsedCableRow["shaftValues"] = [];

	for (const [columnIndex, header] of headerRow.entries()) {
		const label = normalizeCellValue(header);
		const cellValue = normalizeCellValue(row[columnIndex]);
		const match = label.match(/^Ш_(\d+)$/);

		if (!match || !cellValue) {
			continue;
		}

		shaftValues.push({
			column: columnIndex,
			label,
			value: cellValue,
			shaft: Number(match[1]),
		});
	}

	return shaftValues;
}

function groupKeyForRow(row: ParsedCableRow) {
	return [
		row.graphSide,
		row.graphSubzone ?? "none",
		row.fromZone || "unknown",
		row.level,
	].join(":");
}

function createAggregatedGroup(row: ParsedCableRow): AggregatedGroup {
	return {
		groupKey: groupKeyForRow(row),
		graphSide: row.graphSide,
		graphSubzone: row.graphSubzone,
		sourceZone: row.fromZone,
		level: row.level,
		levelOrder: row.levelOrder,
		primaryRooms: new Map(),
		secondaryRooms: new Map(),
		cableCount: 0,
		threadCount: 0,
		totalLength: 0,
		bucketThreads: {
			0: 0,
			1: 0,
			2: 0,
			3: 0,
			4: 0,
		},
	};
}

function upsertGroupRoom(
	rooms: Map<string, AggregatedRoom>,
	roomName: string,
	roomRole: "primary" | "secondary",
) {
	const current = rooms.get(roomName);

	if (current) {
		return current;
	}

	const nextRoom: AggregatedRoom = {
		roomName,
		roomRole,
		cableCount: 0,
		threadCount: 0,
		totalLength: 0,
		sortOrder: rooms.size,
	};

	rooms.set(roomName, nextRoom);
	return nextRoom;
}

function chunkValues<T>(values: T[], size: number) {
	const chunks: T[][] = [];

	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size));
	}

	return chunks;
}

function parseWorkbookRows(fileName: string, buffer: Buffer) {
	const workbook = XLSX.read(buffer, {
		type: "buffer",
		cellDates: false,
		raw: false,
	});
	const sheet = workbook.Sheets.Общ;

	if (!sheet) {
		throw new Error('В файле отсутствует лист "Общ".');
	}

	const rawRows = XLSX.utils.sheet_to_json<string[]>(sheet, {
		header: 1,
		raw: false,
		defval: "",
		blankrows: false,
	});

	if (rawRows.length < 2) {
		throw new Error('Лист "Общ" не содержит данных для импорта.');
	}

	const headerRow = rawRows[0].map(normalizeCellValue);
	const parsedRows = rawRows
		.slice(1)
		.map((rawRow, index) => {
			const row = rawRow.map(normalizeCellValue);
			const cableLabel = row[workbookColumnIndexes.cableLabel] ?? "";
			const level = row[workbookColumnIndexes.level] ?? "";
			const fromZone = row[workbookColumnIndexes.fromZone] ?? "";
			const fromRoom = row[workbookColumnIndexes.fromRoom] ?? "";
			const toRoom = row[workbookColumnIndexes.toRoom] ?? "";

			if (!cableLabel || !level || !fromZone || (!fromRoom && !toRoom)) {
				return null;
			}

			const graphSide = resolveGraphSide(fromZone);
			const graphSubzone = resolveGraphSubzone(fromZone, graphSide);
			const shaftValues = extractShaftValues(row, headerRow);
			const farthestShaft =
				shaftValues.length > 0
					? Math.max(...shaftValues.map((entry) => entry.shaft))
					: null;

			return {
				sourceRowIndex: index + 2,
				cableLabel,
				cableJournal: row[workbookColumnIndexes.cableJournal] ?? "",
				cableNumber: row[workbookColumnIndexes.cableNumber] ?? "",
				repeatFrom: row[workbookColumnIndexes.repeatFrom] ?? "",
				repeatTo: row[workbookColumnIndexes.repeatTo] ?? "",
				repeatKks: row[workbookColumnIndexes.repeatKks] ?? "",
				fromRoom: enToRuVisual(fromRoom),
				fromLocation: row[workbookColumnIndexes.fromLocation] ?? "",
				fromEquipment: row[workbookColumnIndexes.fromEquipment] ?? "",
				toRoom,
				threadLength: parseLocaleNumber(
					row[workbookColumnIndexes.threadLength] ?? "",
				),
				threadCount: parseInteger(row[workbookColumnIndexes.threadCount] ?? ""),
				totalLength: parseLocaleNumber(
					row[workbookColumnIndexes.totalLength] ?? "",
				),
				level,
				levelOrder: parseLocaleNumber(level),
				fromZone,
				toZone: row[workbookColumnIndexes.toZone] ?? "",
				graphSide,
				graphSubzone,
				farthestShaft,
				shaftValues,
				route: row[workbookColumnIndexes.route] ?? "",
				rawRow: row,
			} satisfies ParsedCableRow;
		})
		.filter((row): row is ParsedCableRow => row !== null);

	if (parsedRows.length === 0) {
		throw new Error(
			`В "${fileName}" не удалось найти валидные строки на листе "Общ".`,
		);
	}

	return parsedRows;
}

function aggregateGroups(rows: ParsedCableRow[]) {
	const groups = new Map<string, AggregatedGroup>();
	const uniqueLevels = new Set<string>();
	const sideSummary = new Map<
		GraphSide,
		{
			groupCount: number;
			roomNames: Set<string>;
		}
	>();

	for (const row of rows) {
		uniqueLevels.add(row.level);

		const groupKey = groupKeyForRow(row);
		const group = groups.get(groupKey) ?? createAggregatedGroup(row);
		groups.set(groupKey, group);

		group.cableCount += 1;
		group.threadCount += row.threadCount;
		group.totalLength += row.totalLength;

		const bucket = (row.farthestShaft ?? 0) as 0 | 1 | 2 | 3 | 4;
		group.bucketThreads[bucket] += row.threadCount;

		if (isMeaningfulValue(row.fromRoom)) {
			const room = upsertGroupRoom(group.primaryRooms, row.fromRoom, "primary");
			room.cableCount += 1;
			room.threadCount += row.threadCount;
			room.totalLength += row.totalLength;
		}

		if (
			isMeaningfulValue(row.toRoom) &&
			row.toRoom !== row.fromRoom &&
			!group.primaryRooms.has(row.toRoom)
		) {
			const room = upsertGroupRoom(
				group.secondaryRooms,
				row.toRoom,
				"secondary",
			);
			room.cableCount += 1;
			room.threadCount += row.threadCount;
			room.totalLength += row.totalLength;
		}

		const sideState = sideSummary.get(row.graphSide) ?? {
			groupCount: 0,
			roomNames: new Set<string>(),
		};

		sideState.roomNames.add(row.fromRoom);
		sideSummary.set(row.graphSide, sideState);
	}

	for (const group of groups.values()) {
		const sideState = sideSummary.get(group.graphSide);

		if (sideState) sideState.groupCount += 1;
	}

	const orderedLevels = [...uniqueLevels].sort(
		(left, right) => parseLocaleNumber(right) - parseLocaleNumber(left),
	);

	return {
		orderedLevels,
		groups: [...groups.values()].sort((left, right) => {
			if (left.levelOrder !== right.levelOrder) {
				return right.levelOrder - left.levelOrder;
			}

			if (left.graphSide !== right.graphSide) {
				return left.graphSide.localeCompare(right.graphSide);
			}

			return left.sourceZone.localeCompare(right.sourceZone, "ru");
		}),
		sideSummary: [...sideSummary.entries()].map(([side, value]) => ({
			side,
			groupCount: value.groupCount,
			roomCount: value.roomNames.size,
		})),
	};
}

function getFileType(fileName: string) {
	const extension = getWorkbookExtension(fileName);

	if (!supportedWorkbookExtensions.includes(extension as never)) {
		throw new Error(
			`Неподдерживаемый формат файла. Разрешены: ${supportedWorkbookExtensions.join(", ")}.`,
		);
	}

	return extension as "ods" | "xlsx" | "xls";
}

// TODO: Add more file validation
async function ensureUploadFile(formData: FormData) {
	const file = formData.get("file");

	if (!(file instanceof File)) throw new Error("Выберите файл для импорта.");

	if (file.size === 0) throw new Error("Файл для импорта пустой.");

	return file;
}

export async function importWorkbookFromFormData(
	formData: FormData,
	session: AuthSession,
) {
	const file = await ensureUploadFile(formData);
	const fileType = getFileType(file.name);
	const buffer = Buffer.from(await file.arrayBuffer());
	const parsedRows = parseWorkbookRows(file.name, buffer);
	const { groups, orderedLevels, sideSummary } = aggregateGroups(parsedRows);
	const checksum = createHash("sha256").update(buffer).digest("hex");
	const db = getDb();
	const now = new Date();

	const [snapshot] = await db.transaction(async (tx) => {
		await tx.update(importSnapshots).set({
			isActive: false,
			updatedAt: now,
		});

		const [createdSnapshot] = await tx
			.insert(importSnapshots)
			.values({
				fileName: file.name,
				fileType,
				checksum,
				importedByUserId: session.id,
				rowCount: parsedRows.length,
				isActive: true,
				summary: {
					levels: orderedLevels,
					sides: sideSummary,
				},
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		for (const chunk of chunkValues(
			parsedRows.map((row) => ({
				snapshotId: createdSnapshot.id,
				...row,
				createdAt: now,
			})),
			500,
		)) {
			await tx.insert(importedCableRows).values(chunk);
		}

		const insertedGroups = await tx
			.insert(graphGroups)
			.values(
				groups.map((group) => ({
					snapshotId: createdSnapshot.id,
					groupKey: group.groupKey,
					graphSide: group.graphSide,
					graphSubzone: group.graphSubzone,
					sourceZone: group.sourceZone,
					level: group.level,
					levelOrder: group.levelOrder,
					primaryRooms: sortRoomNames(group.primaryRooms.keys()),
					secondaryRooms: sortRoomNames(group.secondaryRooms.keys()),
					cableCount: group.cableCount,
					threadCount: group.threadCount,
					totalLength: group.totalLength,
					noShaftThreads: group.bucketThreads[0],
					shaft1Threads: group.bucketThreads[1],
					shaft2Threads: group.bucketThreads[2],
					shaft3Threads: group.bucketThreads[3],
					shaft4Threads: group.bucketThreads[4],
					createdAt: now,
				})),
			)
			.returning({
				id: graphGroups.id,
				groupKey: graphGroups.groupKey,
			});

		const groupIdByKey = new Map(
			insertedGroups.map((group) => [group.groupKey, group.id]),
		);
		const roomRows = groups.flatMap((group) => {
			const groupId = groupIdByKey.get(group.groupKey);

			if (!groupId) return [];

			const primaryRooms = sortRoomNames(group.primaryRooms.keys()).map(
				(roomName, index) => {
					const room = group.primaryRooms.get(roomName);

					return {
						snapshotId: createdSnapshot.id,
						groupId,
						roomName,
						roomRole: "primary" as const,
						sortOrder: index,
						cableCount: room?.cableCount ?? 0,
						threadCount: room?.threadCount ?? 0,
						totalLength: room?.totalLength ?? 0,
						progress: 0,
						effectiveDate: getTodayInMoscow(),
						updatedAt: now,
						createdAt: now,
					};
				},
			);
			const secondaryRooms = sortRoomNames(group.secondaryRooms.keys()).map(
				(roomName, index) => {
					const room = group.secondaryRooms.get(roomName);

					return {
						snapshotId: createdSnapshot.id,
						groupId,
						roomName,
						roomRole: "secondary" as const,
						sortOrder: index,
						cableCount: room?.cableCount ?? 0,
						threadCount: room?.threadCount ?? 0,
						totalLength: room?.totalLength ?? 0,
						progress: 0,
						effectiveDate: getTodayInMoscow(),
						updatedAt: now,
						createdAt: now,
					};
				},
			);

			return [...primaryRooms, ...secondaryRooms];
		});

		for (const chunk of chunkValues(roomRows, 500)) {
			await tx.insert(graphGroupRooms).values(chunk);
		}

		return [createdSnapshot];
	});

	return {
		snapshotId: snapshot.id,
		fileName: snapshot.fileName,
		rowCount: snapshot.rowCount,
		groupCount: groups.length,
		levelCount: orderedLevels.length,
	};
}
