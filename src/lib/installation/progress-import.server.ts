import { desc, eq, inArray, sql } from "drizzle-orm";
import * as Xlsx from "xlsx";

import type { AuthSession } from "@/lib/auth/shared";
import { getDb } from "@/lib/db";
import { installationKksItems, installationSnapshots } from "@/lib/db/schema";
import { enToRuVisual } from "@/lib/utils";

import { ensureUploadFile } from "../cable-map/import.server";

type WorkbookProfile = {
	sheetName: string;
	pairs: Array<{
		cableColumn: number;
		doneColumns: number[];
	}>;
};
type DbClient = ReturnType<typeof getDb>;
type ActiveInstallationKksItem = Awaited<ReturnType<typeof getActiveInstallationKksItems>>[number];

const ignoredWorkValues = new Set(["", "-", "нет", "не требуется", "отсутствует", "********"]);
const cableTokenPattern = /(?<![0-9A-ZА-ЯЁ/-])[0-9][0-9A-ZА-ЯЁ/-]*[KК][0-9A-ZА-ЯЁ/-]+(?![0-9A-ZА-ЯЁ/-])/gi;
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
	return enToRuVisual(value).toUpperCase().replace(/\s+/g, "");
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

async function getActiveInstallationSnapshot(db: DbClient) {
	const [snapshot] = await db
		.select({
			id: installationSnapshots.id,
		})
		.from(installationSnapshots)
		.where(eq(installationSnapshots.isActive, true))
		.orderBy(desc(installationSnapshots.createdAt))
		.limit(1);

	return snapshot ?? null;
}

async function getActiveInstallationKksItems(db: DbClient, snapshotId: string) {
	return db
		.select({
			id: installationKksItems.id,
			name: installationKksItems.name,
			itemType: installationKksItems.itemType,
			isDone: installationKksItems.isDone,
		})
		.from(installationKksItems)
		.where(eq(installationKksItems.snapshotId, snapshotId));
}

function getMatchedItems(items: ActiveInstallationKksItem[], completedCableTokens: Set<string>) {
	return items.filter(
		(item) => item.itemType === "cable" && completedCableTokens.has(normalizeCableToken(item.name))
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
	const db = getDb();
	const snapshot = await getActiveInstallationSnapshot(db);

	if (!snapshot) {
		throw new Error("Активный набор данных монтажа не найден.");
	}

	const activeItems = await getActiveInstallationKksItems(db, snapshot.id);
	const matchedRows = getMatchedItems(activeItems, completedCableTokens);
	const changedRows = matchedRows.filter((row) => !row.isDone);

	if (matchedRows.length === 0) {
		return {
			fileCount: uploadFiles.length,
			recognizedCableCount: completedCableTokens.size,
			matchedCableCount: 0,
			changedCableCount: 0,
		};
	}

	const now = new Date();

	await db.transaction(async (tx) => {
		for (const chunk of chunkValues(changedRows, 500)) {
			if (chunk.length === 0) continue;

			await tx
				.update(installationKksItems)
				.set({
					isDone: true,
					revision: sql`${installationKksItems.revision} + 1`,
					updatedByUserId: session.id,
					updatedAt: now,
				})
				.where(
					inArray(
						installationKksItems.id,
						chunk.map((row) => row.id)
					)
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

export const __installationProgressImportTestUtils = {
	parseCompletedCableTokens,
};
