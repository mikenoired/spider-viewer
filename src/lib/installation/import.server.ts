import { createHash } from "node:crypto";

import * as Xlsx from "xlsx";

import type { AuthSession } from "@/lib/auth/shared";
import { getDb } from "@/lib/db";
import { installationKksGroups, installationKksItems, installationSnapshots } from "@/lib/db/schema";

import { ensureUploadFile } from "../cable-map/import.server";

type ParsedInstallationRow = {
	groupName: string;
	kksName: string;
	isDone: boolean;
	sourceRowIndex: number;
};

type AggregatedInstallationGroup = {
	name: string;
	sortOrder: number;
	kksItems: ParsedInstallationRow[];
};

const installationSheetRowLimit = 20_000;
const installationGroupHeaderAliases = ["группа kks", "группа ккс", "группа", "карточка"];
const installationKksHeaderAliases = [
	"kks",
	"ккс",
	"название kks",
	"название ккс",
	"наименование",
	"название",
];
const installationDoneHeaderAliases = ["готово", "готов", "выполнено", "состояние", "статус"];
const doneValueAliases = ["1", "true", "yes", "y", "да", "готово", "готов", "выполнено", "done"];

function normalizeCellValue(value: unknown) {
	return String(value ?? "").trim();
}

function normalizeHeader(value: unknown) {
	return normalizeCellValue(value).toLowerCase();
}

function getFirstSheet(workbook: Xlsx.WorkBook) {
	const sheetName = workbook.SheetNames[0];

	if (!sheetName) {
		throw new Error("Файл монтажа не содержит листов.");
	}

	return workbook.Sheets[sheetName];
}

function getHeaderIndex(headerRow: string[], aliases: string[]) {
	const index = headerRow.findIndex((header) => aliases.includes(header));

	return index >= 0 ? index : null;
}

function parseDoneValue(value: string) {
	return doneValueAliases.includes(value.trim().toLowerCase());
}

function validateInstallationHeaders(groupIndex: number | null, kksIndex: number | null) {
	if (groupIndex === null || kksIndex === null) {
		throw new Error("В файле монтажа нужны колонки группы KKS и названия KKS.");
	}
}

function validateInstallationRowLimit(dataRowCount: number) {
	if (dataRowCount > installationSheetRowLimit) {
		throw new Error(`Файл монтажа содержит больше ${installationSheetRowLimit} строк.`);
	}
}

function parseInstallationRow(
	rawRow: unknown[],
	index: number,
	groupIndex: number,
	kksIndex: number,
	doneIndex: number | null
) {
	const groupName = normalizeCellValue(rawRow[groupIndex]);
	const kksName = normalizeCellValue(rawRow[kksIndex]);

	if (!groupName || !kksName) return null;

	return {
		groupName,
		kksName,
		isDone: doneIndex === null ? false : parseDoneValue(normalizeCellValue(rawRow[doneIndex])),
		sourceRowIndex: index + 2,
	} satisfies ParsedInstallationRow;
}

function parseInstallationRows(fileName: string, buffer: Buffer) {
	const workbook = Xlsx.read(buffer, {
		type: "buffer",
		cellDates: false,
		raw: false,
	});
	const sheet = getFirstSheet(workbook);
	const rawRows = Xlsx.utils.sheet_to_json<unknown[]>(sheet, {
		header: 1,
		raw: false,
		defval: "",
		blankrows: false,
	});

	if (rawRows.length < 2) {
		throw new Error("Файл монтажа не содержит строк для импорта.");
	}

	const headerRow = rawRows[0].map(normalizeHeader);
	const groupIndex = getHeaderIndex(headerRow, installationGroupHeaderAliases);
	const kksIndex = getHeaderIndex(headerRow, installationKksHeaderAliases);
	const doneIndex = getHeaderIndex(headerRow, installationDoneHeaderAliases);

	validateInstallationHeaders(groupIndex, kksIndex);
	validateInstallationRowLimit(rawRows.length - 1);

	const parsedRows = rawRows
		.slice(1)
		.map((row, index) => parseInstallationRow(row, index, groupIndex, kksIndex, doneIndex))
		.filter((row): row is ParsedInstallationRow => row !== null);

	if (parsedRows.length === 0) {
		throw new Error(`В "${fileName}" не удалось найти валидные строки KKS.`);
	}

	return parsedRows;
}

function aggregateInstallationGroups(rows: ParsedInstallationRow[]) {
	const groups = new Map<string, AggregatedInstallationGroup>();
	const seenKksKeys = new Set<string>();

	for (const row of rows) {
		const group = groups.get(row.groupName) ?? {
			name: row.groupName,
			sortOrder: groups.size,
			kksItems: [],
		};
		const kksKey = `${row.groupName}\n${row.kksName}`;

		groups.set(row.groupName, group);

		if (seenKksKeys.has(kksKey)) continue;

		seenKksKeys.add(kksKey);
		group.kksItems.push(row);
	}

	return [...groups.values()];
}

function chunkValues<T>(values: T[], size: number) {
	const chunks: T[][] = [];

	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size));
	}

	return chunks;
}

export async function importInstallationWorkbookFromFormData(formData: FormData, session: AuthSession) {
	const { file, fileType, buffer } = await ensureUploadFile(formData);
	const parsedRows = parseInstallationRows(file.name, buffer);
	const groups = aggregateInstallationGroups(parsedRows);
	const checksum = createHash("sha256").update(buffer).digest("hex");
	const db = getDb();
	const now = new Date();

	const [snapshot] = await db.transaction(async (tx) => {
		await tx.update(installationSnapshots).set({
			isActive: false,
			updatedAt: now,
		});

		const [createdSnapshot] = await tx
			.insert(installationSnapshots)
			.values({
				fileName: file.name,
				fileType,
				checksum,
				importedByUserId: session.id,
				rowCount: parsedRows.length,
				isActive: true,
				summary: {
					groupCount: groups.length,
					kksCount: groups.reduce((total, group) => total + group.kksItems.length, 0),
				},
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		const insertedGroups = await tx
			.insert(installationKksGroups)
			.values(
				groups.map((group) => ({
					snapshotId: createdSnapshot.id,
					name: group.name,
					sortOrder: group.sortOrder,
					kksCount: group.kksItems.length,
					createdAt: now,
				}))
			)
			.returning({
				id: installationKksGroups.id,
				name: installationKksGroups.name,
			});

		const groupIdByName = new Map(insertedGroups.map((group) => [group.name, group.id]));
		const kksRows = groups.flatMap((group) => buildKksRows(group, groupIdByName, createdSnapshot.id, now));

		for (const chunk of chunkValues(kksRows, 500)) {
			await tx.insert(installationKksItems).values(chunk);
		}

		return [createdSnapshot];
	});

	return {
		snapshotId: snapshot.id,
		fileName: snapshot.fileName,
		rowCount: snapshot.rowCount,
		groupCount: groups.length,
		kksCount: groups.reduce((total, group) => total + group.kksItems.length, 0),
	};
}

function buildKksRows(
	group: AggregatedInstallationGroup,
	groupIdByName: Map<string, string>,
	snapshotId: string,
	now: Date
) {
	const groupId = groupIdByName.get(group.name);

	if (!groupId) return [];

	return group.kksItems.map((item, index) => ({
		snapshotId,
		groupId,
		name: item.kksName,
		sortOrder: index,
		isDone: item.isDone,
		revision: 1,
		updatedAt: now,
		createdAt: now,
	}));
}
