import { and, eq } from "drizzle-orm";
import * as Xlsx from "xlsx";

import type { AuthSession } from "@/lib/auth/shared";
import { getTodayIsoInMoscow } from "@/lib/cable-map/report-utils";
import { getDb } from "@/lib/db";
import {
	cableChangeAuditLogs,
	cableProgress,
	graphGroupRooms,
	graphGroups,
	importedCableRows,
	importSnapshots,
} from "@/lib/db/schema";

import { ensureUploadFile } from "../cable-map/import.server";

type WorkbookProfile = {
	sheetName: string;
	pairs: Array<{
		cableColumn: number;
		doneColumns: number[];
	}>;
};

const ignoredWorkValues = new Set(["", "-", "нет", "не требуется", "отсутствует", "********"]);
const cableTokenPattern = /\b[0-9][0-9A-ZА-ЯЁ/-]*[KК][0-9A-ZА-ЯЁ/-]+\b/gi;
const workbookProfiles: WorkbookProfile[] = [
	{
		sheetName: "ЭМР ИК",
		pairs: [
			{ cableColumn: 15, doneColumns: [16, 17] },
			{ cableColumn: 20, doneColumns: [21, 22, 23] },
		],
	},
	{
		sheetName: "Арматура",
		pairs: [
			{ cableColumn: 13, doneColumns: [14] },
			{ cableColumn: 15, doneColumns: [16] },
			{ cableColumn: 17, doneColumns: [18] },
			{ cableColumn: 19, doneColumns: [20] },
			{ cableColumn: 21, doneColumns: [22] },
			{ cableColumn: 23, doneColumns: [24] },
			{ cableColumn: 25, doneColumns: [26] },
		],
	},
];

function normalizeValue(value: unknown) {
	return String(value ?? "").trim();
}

function normalizeCableToken(value: string) {
	return value.toUpperCase().replaceAll("К", "K").replace(/\s+/g, "");
}

function getCableTokens(value: unknown) {
	return [...normalizeValue(value).matchAll(cableTokenPattern)].map((match) => normalizeCableToken(match[0]));
}

function hasMeaningfulDoneValue(value: unknown) {
	const normalized = normalizeValue(value).toLowerCase().replace(/\s+/g, " ");

	return !ignoredWorkValues.has(normalized);
}

function getProfileForWorkbook(workbook: Xlsx.WorkBook) {
	return workbookProfiles.find((profile) => workbook.Sheets[profile.sheetName]);
}

function parseProfileWorkbook(workbook: Xlsx.WorkBook, profile: WorkbookProfile) {
	const sheet = workbook.Sheets[profile.sheetName];
	const rows = Xlsx.utils.sheet_to_json<unknown[]>(sheet, {
		header: 1,
		raw: false,
		defval: "",
		blankrows: false,
	});
	const explicitDoneTokens = new Set<string>();
	const allCandidateTokens = new Set<string>();

	for (const row of rows.slice(2)) {
		for (const pair of profile.pairs) {
			const tokens = getCableTokens(row[pair.cableColumn]);

			for (const token of tokens) {
				allCandidateTokens.add(token);
			}

			if (pair.doneColumns.some((column) => hasMeaningfulDoneValue(row[column]))) {
				for (const token of tokens) {
					explicitDoneTokens.add(token);
				}
			}
		}
	}

	// Some site journals are exported as "completed work" files with empty signature/date cells.
	// In that case the workbook itself is the completion list, so use all recognized cable tokens.
	return explicitDoneTokens.size > 0 ? explicitDoneTokens : allCandidateTokens;
}

function parseGenericWorkbook(workbook: Xlsx.WorkBook) {
	const tokens = new Set<string>();

	for (const sheetName of workbook.SheetNames) {
		const sheet = workbook.Sheets[sheetName];
		const rows = Xlsx.utils.sheet_to_json<unknown[]>(sheet, {
			header: 1,
			raw: false,
			defval: "",
			blankrows: false,
		});

		for (const row of rows) {
			for (const cell of row) {
				for (const token of getCableTokens(cell)) {
					tokens.add(token);
				}
			}
		}
	}

	return tokens;
}

function parseCompletedCableTokens(fileName: string, buffer: Buffer) {
	const workbook = Xlsx.read(buffer, {
		type: "buffer",
		cellDates: false,
		raw: false,
	});
	const profile = getProfileForWorkbook(workbook);
	const tokens = profile ? parseProfileWorkbook(workbook, profile) : parseGenericWorkbook(workbook);

	if (tokens.size === 0) {
		throw new Error(`В "${fileName}" не удалось найти кабели для отметки выполненных работ.`);
	}

	return tokens;
}

function extractImportedCableToken(cableLabel: string) {
	return getCableTokens(cableLabel)[0] ?? normalizeCableToken(cableLabel.split(/\s+/)[0] ?? cableLabel);
}

async function getActiveInstallationCableRows() {
	const db = getDb();

	return db
		.select({
			snapshotId: importedCableRows.snapshotId,
			cableRowId: importedCableRows.id,
			cableLabel: importedCableRows.cableLabel,
			shaft: importedCableRows.farthestShaft,
			groupId: graphGroups.id,
			roomId: graphGroupRooms.id,
			roomName: graphGroupRooms.roomName,
			progress: cableProgress.progress,
		})
		.from(importedCableRows)
		.innerJoin(
			importSnapshots,
			and(
				eq(importSnapshots.id, importedCableRows.snapshotId),
				eq(importSnapshots.snapshotKind, "installation"),
				eq(importSnapshots.isActive, true)
			)
		)
		.innerJoin(
			graphGroups,
			and(
				eq(graphGroups.snapshotId, importedCableRows.snapshotId),
				eq(graphGroups.graphSide, importedCableRows.graphSide),
				eq(graphGroups.graphSubzone, importedCableRows.graphSubzone),
				eq(graphGroups.sourceZone, importedCableRows.fromZone),
				eq(graphGroups.level, importedCableRows.level)
			)
		)
		.innerJoin(
			graphGroupRooms,
			and(
				eq(graphGroupRooms.groupId, graphGroups.id),
				eq(graphGroupRooms.roomRole, "primary"),
				eq(graphGroupRooms.roomName, importedCableRows.fromRoom)
			)
		)
		.leftJoin(
			cableProgress,
			and(
				eq(cableProgress.snapshotId, importedCableRows.snapshotId),
				eq(cableProgress.cableRowId, importedCableRows.id)
			)
		);
}

function chunkValues<T>(values: T[], size: number) {
	const chunks: T[][] = [];

	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size));
	}

	return chunks;
}

export async function importInstallationProgressFromFormData(formData: FormData, session: AuthSession) {
	const files = formData.getAll("files").filter((file): file is File => file instanceof File);
	const uploadFiles =
		files.length > 0 ? files : [formData.get("file")].filter((file): file is File => file instanceof File);

	if (uploadFiles.length === 0) {
		throw new Error("Выберите файлы выполненных работ.");
	}

	const tokenSets = await Promise.all(
		uploadFiles.map(async (file) => {
			const singleFileFormData = new FormData();
			singleFileFormData.set("file", file);
			const upload = await ensureUploadFile(singleFileFormData);

			return parseCompletedCableTokens(upload.file.name, upload.buffer);
		})
	);
	const completedCableTokens = new Set(tokenSets.flatMap((tokens) => [...tokens]));
	const activeRows = await getActiveInstallationCableRows();
	const matchedRows = activeRows.filter((row) =>
		completedCableTokens.has(extractImportedCableToken(row.cableLabel))
	);
	const changedRows = matchedRows.filter((row) => (row.progress ?? 0) !== 100);

	if (matchedRows.length === 0) {
		return {
			fileCount: uploadFiles.length,
			recognizedCableCount: completedCableTokens.size,
			matchedCableCount: 0,
			changedCableCount: 0,
		};
	}

	const db = getDb();
	const now = new Date();
	const effectiveDate = getTodayIsoInMoscow();

	await db.transaction(async (tx) => {
		for (const chunk of chunkValues(changedRows, 500)) {
			if (chunk.length === 0) continue;

			await tx
				.insert(cableProgress)
				.values(
					chunk.map((row) => ({
						snapshotId: row.snapshotId,
						groupId: row.groupId,
						roomId: row.roomId,
						cableRowId: row.cableRowId,
						progress: 100,
						effectiveDate,
						updatedByUserId: session.id,
						updatedAt: now,
						createdAt: now,
					}))
				)
				.onConflictDoUpdate({
					target: [cableProgress.snapshotId, cableProgress.cableRowId],
					set: {
						progress: 100,
						effectiveDate,
						updatedByUserId: session.id,
						updatedAt: now,
					},
				});
		}

		if (changedRows.length > 0) {
			await tx.insert(cableChangeAuditLogs).values(
				changedRows.map((row) => ({
					snapshotId: row.snapshotId,
					groupId: row.groupId,
					roomId: row.roomId,
					cableRowId: row.cableRowId,
					roomName: row.roomName,
					cableLabel: row.cableLabel,
					shaft: row.shaft ?? 0,
					userId: session.id,
					userLogin: session.login,
					changedAt: now,
					effectiveDate,
					isBackdated: false,
					oldProgress: row.progress ?? 0,
					newProgress: 100,
					createdAt: now,
				}))
			);
		}
	});

	return {
		fileCount: uploadFiles.length,
		recognizedCableCount: completedCableTokens.size,
		matchedCableCount: matchedRows.length,
		changedCableCount: changedRows.length,
	};
}
