import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import * as Xlsx from "xlsx";

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

import { supportedWorkbookExtensions, supportedWorkbookMimeTypes, type SnapshotKind } from "./shared";

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

type SideSummaryState = {
	groupCount: number;
	roomNames: Set<string>;
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

const installationWorkbookColumnIndexes = {
	cableJournal: 0,
	threadNumber: 6,
	cableMarking: 7,
	cableType: 10,
	cableSection: 11,
	fromRoom: 13,
	fromEquipmentName: 14,
	fromRow: 15,
	fromEquipment: 16,
	toEquipment: 19,
	toEquipmentName: 20,
	toRow: 21,
	toRoom: 24,
	projectLength: 25,
	actualLength: 26,
	route: 30,
} as const;

const maxWorkbookFileSizeBytes = 15 * 1024 * 1024;
const maxWorkbookRowCount = 20_000;
const requiredWorkbookColumnIndexes = [
	workbookColumnIndexes.cableLabel,
	workbookColumnIndexes.fromRoom,
	workbookColumnIndexes.toRoom,
	workbookColumnIndexes.level,
	workbookColumnIndexes.fromZone,
] as const;

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

function parseCableCoreCount(value: string) {
	const match = value.match(/(\d+)\s*[xх×]/i);

	return match ? Number(match[1]) : 1;
}

function getWorkbookCell(row: string[], columnIndex: number) {
	return row[columnIndex] ?? "";
}

function getWorkbookExtension(fileName: string) {
	return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function hasZipWorkbookSignature(buffer: Buffer) {
	return (
		buffer.length >= 4 &&
		buffer[0] === 0x50 &&
		buffer[1] === 0x4b &&
		(buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
		(buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)
	);
}

function hasLegacyExcelSignature(buffer: Buffer) {
	return (
		buffer.length >= 8 &&
		buffer[0] === 0xd0 &&
		buffer[1] === 0xcf &&
		buffer[2] === 0x11 &&
		buffer[3] === 0xe0 &&
		buffer[4] === 0xa1 &&
		buffer[5] === 0xb1 &&
		buffer[6] === 0x1a &&
		buffer[7] === 0xe1
	);
}

export function hasExpectedWorkbookSignature(fileType: "ods" | "xlsx" | "xls", buffer: Buffer) {
	if (fileType === "xls") {
		return hasLegacyExcelSignature(buffer);
	}

	return hasZipWorkbookSignature(buffer);
}

function resolveGraphSide(fromZone: string): GraphSide {
	return fromZone === "ЧЗ" ? "clean" : "dirty";
}

function resolveGraphSubzone(fromZone: string, graphSide: GraphSide): GraphSubzone {
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
		})
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

function getFarthestShaft(shaftValues: ParsedCableRow["shaftValues"]) {
	return shaftValues.length > 0 ? Math.max(...shaftValues.map((entry) => entry.shaft)) : null;
}

function getFarthestInstallationShaft(route: string, fromRow: string, toRow: string) {
	const routeShafts = [...route.matchAll(/\b([1-4])\b/g)].map((match) => Number(match[1]));
	const rowShafts = [fromRow, toRow].map(parseInteger).filter((value) => value >= 1 && value <= 4);
	const shafts = [...routeShafts, ...rowShafts];

	return shafts.length > 0 ? Math.max(...shafts) : null;
}

function hasRequiredRowData({
	cableLabel,
	level,
	fromZone,
	fromRoom,
	toRoom,
}: {
	cableLabel: string;
	level: string;
	fromZone: string;
	fromRoom: string;
	toRoom: string;
}) {
	return cableLabel !== "" && level !== "" && fromZone !== "" && (fromRoom !== "" || toRoom !== "");
}

function parseWorkbookDataRow(rawRow: string[], index: number, headerRow: string[]): ParsedCableRow | null {
	const row = rawRow.map(normalizeCellValue);
	const cableLabel = getWorkbookCell(row, workbookColumnIndexes.cableLabel);
	const level = getWorkbookCell(row, workbookColumnIndexes.level);
	const fromZone = getWorkbookCell(row, workbookColumnIndexes.fromZone);
	const fromRoom = getWorkbookCell(row, workbookColumnIndexes.fromRoom);
	const toRoom = getWorkbookCell(row, workbookColumnIndexes.toRoom);

	if (!hasRequiredRowData({ cableLabel, level, fromZone, fromRoom, toRoom })) {
		return null;
	}

	const graphSide = resolveGraphSide(fromZone);
	const graphSubzone = resolveGraphSubzone(fromZone, graphSide);
	const shaftValues = extractShaftValues(row, headerRow);

	return {
		sourceRowIndex: index + 2,
		cableLabel,
		cableJournal: getWorkbookCell(row, workbookColumnIndexes.cableJournal),
		cableNumber: getWorkbookCell(row, workbookColumnIndexes.cableNumber),
		repeatFrom: getWorkbookCell(row, workbookColumnIndexes.repeatFrom),
		repeatTo: getWorkbookCell(row, workbookColumnIndexes.repeatTo),
		repeatKks: getWorkbookCell(row, workbookColumnIndexes.repeatKks),
		fromRoom: enToRuVisual(fromRoom),
		fromLocation: getWorkbookCell(row, workbookColumnIndexes.fromLocation),
		fromEquipment: getWorkbookCell(row, workbookColumnIndexes.fromEquipment),
		toRoom,
		threadLength: parseLocaleNumber(getWorkbookCell(row, workbookColumnIndexes.threadLength)),
		threadCount: parseInteger(getWorkbookCell(row, workbookColumnIndexes.threadCount)),
		totalLength: parseLocaleNumber(getWorkbookCell(row, workbookColumnIndexes.totalLength)),
		level,
		levelOrder: parseLocaleNumber(level),
		fromZone,
		toZone: getWorkbookCell(row, workbookColumnIndexes.toZone),
		graphSide,
		graphSubzone,
		farthestShaft: getFarthestShaft(shaftValues),
		shaftValues,
		route: getWorkbookCell(row, workbookColumnIndexes.route),
		rawRow: row,
	} satisfies ParsedCableRow;
}

function getInstallationLevel(fromRow: string, toRow: string) {
	const row = fromRow || toRow;

	return row ? `Ряд ${row}` : "Ряд не указан";
}

function createInstallationCableLabel(row: string[]) {
	const marking = getWorkbookCell(row, installationWorkbookColumnIndexes.cableMarking);
	const cableType = getWorkbookCell(row, installationWorkbookColumnIndexes.cableType);
	const cableSection = getWorkbookCell(row, installationWorkbookColumnIndexes.cableSection);

	return [marking, cableType, cableSection].filter(Boolean).join(" ");
}

function parseInstallationSideRow(rawRow: string[], index: number, side: GraphSide): ParsedCableRow | null {
	const row = rawRow.map(normalizeCellValue);
	const cableLabel = createInstallationCableLabel(row);
	const cableNumber = getWorkbookCell(row, installationWorkbookColumnIndexes.threadNumber);
	const fromRoom = enToRuVisual(getWorkbookCell(row, installationWorkbookColumnIndexes.fromRoom));
	const toRoom = enToRuVisual(getWorkbookCell(row, installationWorkbookColumnIndexes.toRoom));
	const fromRow = getWorkbookCell(row, installationWorkbookColumnIndexes.fromRow);
	const toRow = getWorkbookCell(row, installationWorkbookColumnIndexes.toRow);
	const fromEquipment = getWorkbookCell(row, installationWorkbookColumnIndexes.fromEquipment);
	const toEquipment = getWorkbookCell(row, installationWorkbookColumnIndexes.toEquipment);
	const primaryRoom = side === "dirty" ? fromEquipment : toEquipment;
	const secondaryRoom = side === "dirty" ? toEquipment : fromEquipment;
	const route = getWorkbookCell(row, installationWorkbookColumnIndexes.route);
	const level = getInstallationLevel(side === "dirty" ? fromRow : toRow, side === "dirty" ? toRow : fromRow);
	const levelOrder =
		parseLocaleNumber(side === "dirty" ? fromRow : toRow) || parseLocaleNumber(fromRow || toRow);
	const actualLength = parseLocaleNumber(
		getWorkbookCell(row, installationWorkbookColumnIndexes.actualLength)
	);
	const projectLength = parseLocaleNumber(
		getWorkbookCell(row, installationWorkbookColumnIndexes.projectLength)
	);
	const totalLength = actualLength > 0 ? actualLength : projectLength;
	const cableSection = getWorkbookCell(row, installationWorkbookColumnIndexes.cableSection);
	const sourceZone = side === "dirty" ? fromRoom : toRoom;
	const farthestShaft = getFarthestInstallationShaft(route, fromRow, toRow);

	if (!cableLabel || !primaryRoom || !sourceZone) {
		return null;
	}

	return {
		sourceRowIndex: index + 3,
		cableLabel,
		cableJournal: getWorkbookCell(row, installationWorkbookColumnIndexes.cableJournal),
		cableNumber,
		repeatFrom: "",
		repeatTo: "",
		repeatKks: "",
		fromRoom: primaryRoom,
		fromLocation: side === "dirty" ? fromRoom : toRoom,
		fromEquipment: side === "dirty" ? fromEquipment : toEquipment,
		toRoom: secondaryRoom,
		threadLength: totalLength,
		threadCount: Math.max(1, parseCableCoreCount(cableSection)),
		totalLength,
		level,
		levelOrder,
		fromZone: sourceZone,
		toZone: side === "dirty" ? toRoom : fromRoom,
		graphSide: side,
		graphSubzone: side === "dirty" ? "dirty" : "clean",
		farthestShaft,
		shaftValues: [],
		route,
		rawRow: row,
	} satisfies ParsedCableRow;
}

function validateWorkbookStructure(headerRow: string[]) {
	const lastRequiredColumnIndex = Math.max(...requiredWorkbookColumnIndexes);

	if (headerRow.length <= lastRequiredColumnIndex) {
		throw new Error('Структура листа "Общ" не соответствует ожидаемому шаблону.');
	}
}

function validateWorkbookRowCount(dataRowCount: number) {
	if (dataRowCount > maxWorkbookRowCount) {
		throw new Error(
			`Файл содержит слишком много строк для безопасного импорта (${dataRowCount}). Лимит: ${maxWorkbookRowCount}.`
		);
	}
}

function groupKeyForRow(row: ParsedCableRow) {
	return [row.graphSide, row.graphSubzone ?? "none", row.fromZone || "unknown", row.level].join(":");
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
	roomRole: "primary" | "secondary"
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

export function parseWorkbookRows(fileName: string, buffer: Buffer): ParsedCableRow[] {
	const workbook = Xlsx.read(buffer, {
		type: "buffer",
		cellDates: false,
		raw: false,
	});
	const sheet = workbook.Sheets.Общ;

	if (!sheet) {
		throw new Error('В файле отсутствует лист "Общ".');
	}

	const rawRows = Xlsx.utils.sheet_to_json<string[]>(sheet, {
		header: 1,
		raw: false,
		defval: "",
		blankrows: false,
	});

	if (rawRows.length < 2) {
		throw new Error('Лист "Общ" не содержит данных для импорта.');
	}

	const headerRow = rawRows[0].map(normalizeCellValue);
	validateWorkbookStructure(headerRow);

	const dataRowCount = rawRows.length - 1;
	validateWorkbookRowCount(dataRowCount);

	const parsedRows = rawRows
		.slice(1)
		.map((rawRow, index) => parseWorkbookDataRow(rawRow, index, headerRow))
		.filter((row): row is ParsedCableRow => row !== null);

	if (parsedRows.length === 0) {
		throw new Error(`В "${fileName}" не удалось найти валидные строки на листе "Общ".`);
	}

	return parsedRows;
}

function getInstallationWorkbookSheet(workbook: Xlsx.WorkBook) {
	const sheet = workbook.Sheets.УСБТ ?? workbook.Sheets["Лист1"];

	if (!sheet) {
		throw new Error('В файле монтажа отсутствует лист "УСБТ".');
	}

	return sheet;
}

export function parseInstallationWorkbookRows(fileName: string, buffer: Buffer): ParsedCableRow[] {
	const workbook = Xlsx.read(buffer, {
		type: "buffer",
		cellDates: false,
		raw: false,
	});
	const sheet = getInstallationWorkbookSheet(workbook);
	const rawRows = Xlsx.utils.sheet_to_json<string[]>(sheet, {
		header: 1,
		raw: false,
		defval: "",
		blankrows: false,
	});

	if (rawRows.length < 3) {
		throw new Error("Файл монтажа не содержит данных для импорта карты.");
	}

	validateWorkbookRowCount(rawRows.length - 2);

	const parsedRows = rawRows
		.slice(2)
		.flatMap((rawRow, index) => [
			parseInstallationSideRow(rawRow, index, "dirty"),
			parseInstallationSideRow(rawRow, index, "clean"),
		])
		.filter((row): row is ParsedCableRow => row !== null);

	if (parsedRows.length === 0) {
		throw new Error(`В "${fileName}" не удалось найти валидные строки монтажа.`);
	}

	return parsedRows;
}

function aggregateGroups(rows: ParsedCableRow[]) {
	const groups = new Map<string, AggregatedGroup>();
	const uniqueLevels = new Set<string>();
	const sideSummary = new Map<GraphSide, SideSummaryState>();

	function updateGroupTotals(group: AggregatedGroup, row: ParsedCableRow) {
		group.cableCount += 1;
		group.threadCount += row.threadCount;
		group.totalLength += row.totalLength;

		const bucket = (row.farthestShaft ?? 0) as 0 | 1 | 2 | 3 | 4;
		group.bucketThreads[bucket] += row.threadCount;
	}

	function updatePrimaryRoom(group: AggregatedGroup, row: ParsedCableRow) {
		if (!isMeaningfulValue(row.fromRoom)) {
			return;
		}

		const room = upsertGroupRoom(group.primaryRooms, row.fromRoom, "primary");
		room.cableCount += 1;
		room.threadCount += row.threadCount;
		room.totalLength += row.totalLength;
	}

	function updateSecondaryRoom(group: AggregatedGroup, row: ParsedCableRow) {
		if (!isMeaningfulValue(row.toRoom) || row.toRoom === row.fromRoom || group.primaryRooms.has(row.toRoom)) {
			return;
		}

		const room = upsertGroupRoom(group.secondaryRooms, row.toRoom, "secondary");
		room.cableCount += 1;
		room.threadCount += row.threadCount;
		room.totalLength += row.totalLength;
	}

	function updateSideSummary(row: ParsedCableRow) {
		const sideState = sideSummary.get(row.graphSide) ?? {
			groupCount: 0,
			roomNames: new Set<string>(),
		};

		sideState.roomNames.add(row.fromRoom);
		sideSummary.set(row.graphSide, sideState);
	}

	for (const row of rows) {
		uniqueLevels.add(row.level);

		const groupKey = groupKeyForRow(row);
		const group = groups.get(groupKey) ?? createAggregatedGroup(row);
		groups.set(groupKey, group);

		updateGroupTotals(group, row);
		updatePrimaryRoom(group, row);
		updateSecondaryRoom(group, row);
		updateSideSummary(row);
	}

	for (const group of groups.values()) {
		const sideState = sideSummary.get(group.graphSide);

		if (sideState) sideState.groupCount += 1;
	}

	const orderedLevels = [...uniqueLevels].sort(
		(left, right) => parseLocaleNumber(right) - parseLocaleNumber(left)
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
		throw new Error(`Неподдерживаемый формат файла. Разрешены: ${supportedWorkbookExtensions.join(", ")}.`);
	}

	return extension as (typeof supportedWorkbookExtensions)[number];
}

// TODO: Add more file validation
export async function ensureUploadFile(formData: FormData, fieldName = "file") {
	const file = formData.get(fieldName);

	if (!(file instanceof File)) throw new Error("Выберите файл для импорта.");

	if (file.size === 0) throw new Error("Файл для импорта пустой.");

	if (file.size > maxWorkbookFileSizeBytes) {
		throw new Error(
			`Файл слишком большой. Максимальный размер: ${Math.floor(maxWorkbookFileSizeBytes / (1024 * 1024))} МБ.`
		);
	}

	const fileType = getFileType(file.name);
	const fileMimeType = file.type.trim().toLowerCase();

	if (
		fileMimeType &&
		fileMimeType !== "application/octet-stream" &&
		!supportedWorkbookMimeTypes.includes(fileMimeType as (typeof supportedWorkbookMimeTypes)[number])
	) {
		throw new Error(`Неверный MIME-тип файла: ${file.type}. Разрешены только таблицы Excel или LibreOffice.`);
	}

	const buffer = Buffer.from(await file.arrayBuffer());

	if (!hasExpectedWorkbookSignature(fileType, buffer)) {
		throw new Error("Файл не похож на корректный workbook выбранного формата.");
	}

	return {
		file,
		fileType,
		buffer,
	};
}

function parseRowsForSnapshotKind(
	fileName: string,
	buffer: Buffer,
	snapshotKind: SnapshotKind
): ParsedCableRow[] {
	return snapshotKind === "installation"
		? parseInstallationWorkbookRows(fileName, buffer)
		: parseWorkbookRows(fileName, buffer);
}

export async function importWorkbookFromFormData(
	formData: FormData,
	session: AuthSession,
	options: {
		snapshotKind?: SnapshotKind;
	} = {}
) {
	const { file, fileType, buffer } = await ensureUploadFile(formData);
	const snapshotKind = options.snapshotKind ?? "demolition";
	const parsedRows = parseRowsForSnapshotKind(file.name, buffer, snapshotKind);
	const { groups, orderedLevels, sideSummary } = aggregateGroups(parsedRows);
	const checksum = createHash("sha256").update(buffer).digest("hex");
	const db = getDb();
	const now = new Date();

	const [snapshot] = await db.transaction(async (tx) => {
		await tx
			.update(importSnapshots)
			.set({
				isActive: false,
				updatedAt: now,
			})
			.where(eq(importSnapshots.snapshotKind, snapshotKind));

		const [createdSnapshot] = await tx
			.insert(importSnapshots)
			.values({
				snapshotKind,
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
			500
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
				}))
			)
			.returning({
				id: graphGroups.id,
				groupKey: graphGroups.groupKey,
			});

		const groupIdByKey = new Map(insertedGroups.map((group) => [group.groupKey, group.id]));
		const roomRows = groups.flatMap((group) => {
			const groupId = groupIdByKey.get(group.groupKey);

			if (!groupId) return [];

			const primaryRooms = sortRoomNames(group.primaryRooms.keys()).map((roomName, index) => {
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
			});
			const secondaryRooms = sortRoomNames(group.secondaryRooms.keys()).map((roomName, index) => {
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
			});

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
