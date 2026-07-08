import { and, eq } from "drizzle-orm";
import * as Xlsx from "xlsx";

import type { AuthSession } from "@/lib/auth/shared";
import { getDb } from "@/lib/db";
import { importSnapshots, priorityRoomEntries, priorityRoomLists } from "@/lib/db/schema";
import { enToRuVisual } from "@/lib/utils";

import {
	priorityRoomListAuthorSchema,
	supportedPriorityListExtensions,
	supportedWorkbookMimeTypes,
} from "./shared";

const maxPriorityListFileSizeBytes = 10 * 1024 * 1024;
const maxPriorityRoomCount = 5_000;
const priorityHeaderValues = new Set(["помещение", "помещения", "комната", "комнаты", "room", "rooms"]);

function chunkValues<T>(values: T[], size: number) {
	const chunks: T[][] = [];

	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size));
	}

	return chunks;
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

function hasExpectedWorkbookSignature(
	fileType: (typeof supportedPriorityListExtensions)[number],
	buffer: Buffer
) {
	if (fileType === "xls") {
		return hasLegacyExcelSignature(buffer);
	}

	return hasZipWorkbookSignature(buffer);
}

function normalizeRoomName(value: string) {
	return enToRuVisual(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function getPriorityRoomCell(row: string[]) {
	return row.map((value) => String(value ?? "").trim()).find(Boolean) ?? "";
}

function isPriorityHeader(value: string) {
	return priorityHeaderValues.has(normalizeRoomName(value));
}

function parsePriorityRoomRows(fileName: string, buffer: Buffer) {
	const workbook = Xlsx.read(buffer, {
		type: "buffer",
		cellDates: false,
		raw: false,
	});
	const sheetName = workbook.SheetNames[0];
	const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;

	if (!sheet) {
		throw new Error("В файле не найден ни один лист со списком помещений.");
	}

	const rawRows = Xlsx.utils.sheet_to_json<string[]>(sheet, {
		header: 1,
		raw: false,
		defval: "",
		blankrows: false,
	});

	const uniqueRooms = new Map<string, string>();

	for (const [index, rawRow] of rawRows.entries()) {
		const roomName = getPriorityRoomCell(rawRow);

		if (!roomName) {
			continue;
		}

		if (index === 0 && isPriorityHeader(roomName)) {
			continue;
		}

		const normalizedRoomName = normalizeRoomName(roomName);

		if (!normalizedRoomName) {
			continue;
		}

		if (!uniqueRooms.has(normalizedRoomName)) {
			uniqueRooms.set(normalizedRoomName, enToRuVisual(roomName).replace(/\s+/g, " ").trim());
		}
	}

	if (uniqueRooms.size === 0) {
		throw new Error(`В "${fileName}" не найдено ни одного помещения для приоритетного списка.`);
	}

	if (uniqueRooms.size > maxPriorityRoomCount) {
		throw new Error(`Список слишком большой: ${uniqueRooms.size} помещений. Лимит: ${maxPriorityRoomCount}.`);
	}

	return [...uniqueRooms.entries()].map(([normalizedRoomName, roomName]) => ({
		roomName,
		normalizedRoomName,
	}));
}

async function ensurePriorityRoomListUpload(formData: FormData) {
	const file = formData.get("file");

	if (!(file instanceof File)) {
		throw new Error("Выберите файл со списком помещений.");
	}

	if (file.size === 0) {
		throw new Error("Файл со списком помещений пустой.");
	}

	if (file.size > maxPriorityListFileSizeBytes) {
		throw new Error(
			`Файл слишком большой. Максимальный размер: ${Math.floor(maxPriorityListFileSizeBytes / (1024 * 1024))} МБ.`
		);
	}

	const authorName = priorityRoomListAuthorSchema.parse(formData.get("author"));
	const fileType = getWorkbookExtension(file.name);

	if (!supportedPriorityListExtensions.includes(fileType as never)) {
		throw new Error(
			`Неподдерживаемый формат списка. Разрешены: ${supportedPriorityListExtensions.join(", ")}.`
		);
	}

	const fileMimeType = file.type.trim().toLowerCase();

	if (
		fileMimeType &&
		fileMimeType !== "application/octet-stream" &&
		!supportedWorkbookMimeTypes.includes(fileMimeType as (typeof supportedWorkbookMimeTypes)[number])
	) {
		throw new Error(`Неверный MIME-тип файла: ${file.type}. Разрешены только таблицы Excel или LibreOffice.`);
	}

	const buffer = Buffer.from(await file.arrayBuffer());

	if (!hasExpectedWorkbookSignature(fileType as (typeof supportedPriorityListExtensions)[number], buffer)) {
		throw new Error("Файл не похож на корректный workbook выбранного формата.");
	}

	return {
		file,
		fileType,
		authorName,
		buffer,
	};
}

export async function importPriorityRoomListFromFormData(formData: FormData, session: AuthSession) {
	const { file, fileType, authorName, buffer } = await ensurePriorityRoomListUpload(formData);
	const rooms = parsePriorityRoomRows(file.name, buffer);
	const db = getDb();
	const now = new Date();

	const [activeSnapshot] = await db
		.select({
			id: importSnapshots.id,
		})
		.from(importSnapshots)
		.where(and(eq(importSnapshots.isActive, true), eq(importSnapshots.snapshotKind, "installation")))
		.limit(1);

	if (!activeSnapshot) {
		throw new Error("Сначала загрузите активную карту монтажа, затем список приоритетных помещений.");
	}

	const [createdList] = await db.transaction(async (tx) => {
		const [list] = await tx
			.insert(priorityRoomLists)
			.values({
				snapshotId: activeSnapshot.id,
				authorName,
				fileName: file.name,
				fileType,
				roomCount: rooms.length,
				importedByUserId: session.id,
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		for (const chunk of chunkValues(
			rooms.map((room, index) => ({
				listId: list.id,
				snapshotId: activeSnapshot.id,
				roomName: room.roomName,
				normalizedRoomName: room.normalizedRoomName,
				sortOrder: index,
				createdAt: now,
			})),
			500
		)) {
			await tx.insert(priorityRoomEntries).values(chunk);
		}

		return [list];
	});

	return {
		id: createdList.id,
		authorName,
		roomCount: rooms.length,
		fileName: file.name,
	};
}

export function __test__normalizePriorityRoomName(value: string) {
	return normalizeRoomName(value);
}

export function __test__parsePriorityRoomRows(fileName: string, buffer: Buffer) {
	return parsePriorityRoomRows(fileName, buffer);
}
