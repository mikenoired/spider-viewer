import { createHash } from "node:crypto";

import * as Xlsx from "xlsx";

import type { AuthSession } from "@/lib/auth/shared";
import { ensureUploadFile } from "@/lib/cable-map/import.server";
import { getDb } from "@/lib/db";
import { installationKksGroups, installationKksItems, installationSnapshots } from "@/lib/db/schema";
import { enToRuVisual } from "@/lib/utils";

import type { InstallationKksItemType } from "./shared";

type ParsedInstallationRow = {
	groupName: string;
	kksName: string;
	itemType: InstallationKksItemType;
	sourceSheet: string;
	sourceRowIndex: number;
	sourceColumnIndex: number;
	sourceColumnLabel: string;
	isDone: boolean;
	matchedInCableBase: boolean;
};

type AggregatedInstallationGroup = {
	name: string;
	sourceSheet: string;
	sortOrder: number;
	kksItems: ParsedInstallationRow[];
};

type CableBaseEntry = {
	isDone: boolean;
};

type WorkbookUpload = Awaited<ReturnType<typeof ensureUploadFile>>;
type DbClient = ReturnType<typeof getDb>;
type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
type SnapshotSummary = ReturnType<typeof createSnapshotSummary>;
type InstallationImportWriteInput = {
	primaryUpload: WorkbookUpload;
	session: AuthSession;
	parsedRows: ParsedInstallationRow[];
	groups: AggregatedInstallationGroup[];
	summary: SnapshotSummary;
	checksum: string;
	now: Date;
};

const installationSheetRowLimit = 20_000;
const legacyGroupHeaderAliases = ["группа kks", "группа ккс", "группа", "карточка"];
const legacyKksHeaderAliases = ["kks", "ккс", "название kks", "название ккс", "наименование", "название"];
const legacyDoneHeaderAliases = ["готово", "готов", "выполнено", "состояние", "статус"];
const doneValueAliases = ["1", "true", "yes", "y", "да", "готово", "готов", "выполнено", "done"];
const prioritySheetName = "Кабеля для ступенчатого пуска н";
const mechanismHeaderAliases = ["kks", "ккс", "ртм пип"];
const cableBaseMarkHeaderAliases = ["монтажная марка", "маркировка кабеля"];
const cableBaseDoneHeaderAliases = ["проложено"];
const ignoredKksKeys = new Set(["ОТСУТСТВУЕТ", "НЕТРЕБУЕТСЯ", "КОМПЛЕКТНОСБКЗ"]);
const kksTokenPattern = /[0-9A-Za-zА-Яа-я][0-9A-Za-zА-Яа-я./-]*[0-9A-Za-zА-Яа-я]/g;

function normalizeCellValue(value: unknown) {
	return String(value ?? "").trim();
}

function normalizeHeader(value: unknown) {
	return normalizeCellValue(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizeKksKey(value: string) {
	return enToRuVisual(value)
		.replace(/\s+/g, "")
		.replace(/[.,;]+$/g, "")
		.toUpperCase();
}

function formatKksName(value: string) {
	return enToRuVisual(value).replace(/\s+/g, "");
}

function parseLocaleNumber(value: string) {
	const normalized = value.replaceAll(" ", "").replace(",", ".");
	const parsed = Number(normalized);

	return Number.isFinite(parsed) ? parsed : 0;
}

function parseDoneValue(value: string) {
	const normalized = value.trim().toLowerCase();

	if (doneValueAliases.includes(normalized)) return true;
	if (normalized === "" || normalized === "0") return false;

	return parseLocaleNumber(normalized) > 0;
}

function getRows(workbook: Xlsx.WorkBook, sheetName: string) {
	const sheet = workbook.Sheets[sheetName];

	if (!sheet) return [];

	return Xlsx.utils.sheet_to_json<unknown[]>(sheet, {
		header: 1,
		raw: false,
		defval: "",
		blankrows: false,
	});
}

function getHeaderIndex(headerRow: string[], aliases: string[]) {
	const index = headerRow.findIndex((header) => aliases.includes(header));

	return index >= 0 ? index : null;
}

function validateRowLimit(dataRowCount: number) {
	if (dataRowCount > installationSheetRowLimit) {
		throw new Error(`Файл монтажа содержит больше ${installationSheetRowLimit} строк.`);
	}
}

function hasLegacyHeaders(headerRow: string[]) {
	return (
		getHeaderIndex(headerRow, legacyGroupHeaderAliases) !== null &&
		getHeaderIndex(headerRow, legacyKksHeaderAliases) !== null
	);
}

function getFirstSheetName(workbook: Xlsx.WorkBook) {
	const sheetName = workbook.SheetNames[0];

	if (!sheetName) {
		throw new Error("Файл монтажа не содержит листов.");
	}

	return sheetName;
}

function parseLegacyRow(
	rawRow: unknown[],
	index: number,
	groupIndex: number,
	kksIndex: number,
	doneIndex: number | null,
	sourceSheet: string
): ParsedInstallationRow | null {
	const groupName = normalizeCellValue(rawRow[groupIndex]);
	const kksName = normalizeCellValue(rawRow[kksIndex]);

	if (!groupName || !kksName) return null;

	return {
		groupName,
		kksName,
		itemType: "cable",
		sourceSheet,
		sourceRowIndex: index + 2,
		sourceColumnIndex: kksIndex + 1,
		sourceColumnLabel: "KKS",
		isDone: doneIndex === null ? false : parseDoneValue(normalizeCellValue(rawRow[doneIndex])),
		matchedInCableBase: false,
	} satisfies ParsedInstallationRow;
}

function parseLegacyRows(fileName: string, workbook: Xlsx.WorkBook) {
	const sourceSheet = getFirstSheetName(workbook);
	const rawRows = getRows(workbook, sourceSheet);

	if (rawRows.length < 2) return [];

	const headerRow = rawRows[0]?.map(normalizeHeader) ?? [];
	const groupIndex = getHeaderIndex(headerRow, legacyGroupHeaderAliases);
	const kksIndex = getHeaderIndex(headerRow, legacyKksHeaderAliases);
	const doneIndex = getHeaderIndex(headerRow, legacyDoneHeaderAliases);

	if (groupIndex === null || kksIndex === null) return [];

	validateRowLimit(rawRows.length - 1);

	const rows = rawRows
		.slice(1)
		.map((row, index) => parseLegacyRow(row, index, groupIndex, kksIndex, doneIndex, sourceSheet))
		.filter((row): row is ParsedInstallationRow => row !== null);

	if (rows.length === 0) {
		throw new Error(`В "${fileName}" не удалось найти валидные строки KKS.`);
	}

	return rows;
}

function isSectionRow(row: unknown[]) {
	const firstCell = normalizeCellValue(row[0]);
	const secondCell = normalizeCellValue(row[1]);
	const filledCount = row.filter((cell) => normalizeCellValue(cell).length > 0).length;

	return Boolean(firstCell) && !secondCell && filledCount <= 2 && !/^\d+$/.test(firstCell);
}

function findSectionRows(rows: unknown[][]) {
	return rows.flatMap((row, index) =>
		isSectionRow(row) ? [{ name: normalizeCellValue(row[0]), index }] : []
	);
}

function getPrioritySheetName(workbook: Xlsx.WorkBook) {
	if (workbook.Sheets[prioritySheetName]) return prioritySheetName;

	return workbook.SheetNames.find((sheetName) => findSectionRows(getRows(workbook, sheetName)).length > 0);
}

function isSubheaderRow(row: unknown[]) {
	const firstCell = normalizeCellValue(row[0]);
	const secondCell = normalizeCellValue(row[1]);
	const filledCount = row.filter((cell) => normalizeCellValue(cell).length > 0).length;

	return !firstCell && !secondCell && filledCount > 0;
}

function isCableHeader(header: string) {
	if (header === "кабельный журнал") return false;
	if (cableBaseMarkHeaderAliases.includes(header)) return true;

	return header === "кабель" || header.startsWith("кабель ") || header.includes("кабель от");
}

function getColumnItemType(header: string) {
	if (mechanismHeaderAliases.includes(header)) return "mechanism";
	if (isCableHeader(header)) return "cable";

	return null;
}

function createColumnLabel(header: string, subheader: string) {
	if (!subheader) return header;

	return `${header}: ${subheader}`;
}

function shouldUseKksToken(token: string) {
	const key = normalizeKksKey(token);

	if (key.length < 4 || ignoredKksKeys.has(key)) return false;
	if (!/[0-9]/.test(key) || !/[А-Я]/.test(key)) return false;

	return true;
}

function extractKksTokens(value: unknown) {
	const matches = normalizeCellValue(value).match(kksTokenPattern) ?? [];
	const uniqueTokens = new Map<string, string>();

	for (const token of matches) {
		if (!shouldUseKksToken(token)) continue;

		uniqueTokens.set(normalizeKksKey(token), formatKksName(token));
	}

	return [...uniqueTokens.values()];
}

function createPriorityRow(
	groupName: string,
	sourceSheet: string,
	row: unknown[],
	rowIndex: number,
	columnIndex: number,
	headers: unknown[],
	subheaders: unknown[],
	statusByKks: Map<string, CableBaseEntry>
) {
	const header = normalizeHeader(headers[columnIndex]);
	const subheader = normalizeCellValue(subheaders[columnIndex]);
	const itemType = getColumnItemType(header);

	if (!itemType) return [];

	return extractKksTokens(row[columnIndex]).map((kksName) => {
		const baseEntry = statusByKks.get(normalizeKksKey(kksName));

		return {
			groupName,
			kksName,
			itemType,
			sourceSheet,
			sourceRowIndex: rowIndex + 1,
			sourceColumnIndex: columnIndex + 1,
			sourceColumnLabel: createColumnLabel(header, subheader),
			isDone: baseEntry?.isDone ?? false,
			matchedInCableBase: Boolean(baseEntry),
		} satisfies ParsedInstallationRow;
	});
}

function parsePrioritySection(
	rows: unknown[][],
	section: { name: string; index: number },
	nextSectionIndex: number,
	sourceSheet: string,
	statusByKks: Map<string, CableBaseEntry>
) {
	const headerIndex = section.index + 1;
	const headers = rows[headerIndex] ?? [];
	const subheaders = isSubheaderRow(rows[headerIndex + 1] ?? []) ? (rows[headerIndex + 1] ?? []) : [];
	const dataStartIndex = subheaders.length > 0 ? headerIndex + 2 : headerIndex + 1;
	const sectionRows = rows.slice(dataStartIndex, nextSectionIndex);

	return sectionRows.flatMap((row, rowOffset) =>
		row.flatMap((_, columnIndex) =>
			createPriorityRow(
				section.name,
				sourceSheet,
				row,
				dataStartIndex + rowOffset,
				columnIndex,
				headers,
				subheaders,
				statusByKks
			)
		)
	);
}

function parsePriorityRows(
	fileName: string,
	workbook: Xlsx.WorkBook,
	statusByKks: Map<string, CableBaseEntry>
) {
	const sheetName = getPrioritySheetName(workbook);

	if (!sheetName) return [];

	const rows = getRows(workbook, sheetName);
	const sections = findSectionRows(rows);
	validateRowLimit(rows.length);

	const parsedRows = sections.flatMap((section, index) =>
		parsePrioritySection(rows, section, sections[index + 1]?.index ?? rows.length, sheetName, statusByKks)
	);

	if (parsedRows.length === 0) {
		throw new Error(`В "${fileName}" не удалось собрать KKS из первоочередных карточек.`);
	}

	return parsedRows;
}

function findSheetHeaderRow(sheet: Xlsx.WorkSheet) {
	for (let rowIndex = 0; rowIndex < 6; rowIndex += 1) {
		const headers = getSheetHeaders(sheet, rowIndex);
		const markIndexes = getHeaderIndexes(headers, cableBaseMarkHeaderAliases);
		const doneIndex = getHeaderIndex(headers, cableBaseDoneHeaderAliases);

		if (markIndexes.length > 0 && doneIndex !== null) return { rowIndex, headers, markIndexes, doneIndex };
	}

	return null;
}

function getSheetHeaders(sheet: Xlsx.WorkSheet, rowIndex: number) {
	return Array.from({ length: 80 }, (_, columnIndex) =>
		normalizeHeader(sheet[Xlsx.utils.encode_cell({ r: rowIndex, c: columnIndex })]?.v)
	);
}

function getHeaderIndexes(headers: string[], aliases: string[]) {
	return headers
		.map((header, index) => (aliases.includes(header) ? index : -1))
		.filter((index) => index >= 0);
}

function getSheetRefEndRow(sheet: Xlsx.WorkSheet) {
	const ref = sheet["!ref"];

	if (!ref) return -1;

	return Xlsx.utils.decode_range(ref).e.r;
}

function upsertCableBaseEntry(index: Map<string, CableBaseEntry>, kksName: string, isDone: boolean) {
	const key = normalizeKksKey(kksName);
	const current = index.get(key) ?? { isDone: false };

	index.set(key, {
		isDone: current.isDone || isDone,
	});
}

function indexCableBaseSheet(index: Map<string, CableBaseEntry>, sheet: Xlsx.WorkSheet) {
	const header = findSheetHeaderRow(sheet);

	if (!header) return;

	let blankStreak = 0;
	const blankStreakLimit = 200;

	for (let rowIndex = header.rowIndex + 1; rowIndex <= getSheetRefEndRow(sheet); rowIndex += 1) {
		const done = parseDoneValue(
			normalizeCellValue(sheet[Xlsx.utils.encode_cell({ r: rowIndex, c: header.doneIndex })]?.v)
		);
		let hasMarkValue = false;

		for (const columnIndex of header.markIndexes) {
			const cell = sheet[Xlsx.utils.encode_cell({ r: rowIndex, c: columnIndex })]?.v;
			hasMarkValue = hasMarkValue || normalizeCellValue(cell).length > 0;

			for (const kksName of extractKksTokens(cell)) {
				upsertCableBaseEntry(index, kksName, done);
			}
		}

		blankStreak = hasMarkValue ? 0 : blankStreak + 1;

		if (blankStreak >= blankStreakLimit) return;
	}
}

function buildCableBaseIndex(workbooks: Xlsx.WorkBook[]) {
	const index = new Map<string, CableBaseEntry>();

	for (const workbook of workbooks) {
		for (const sheetName of workbook.SheetNames) {
			const sheet = workbook.Sheets[sheetName];

			if (sheet) indexCableBaseSheet(index, sheet);
		}
	}

	return index;
}

function parseInstallationRows(
	fileName: string,
	workbook: Xlsx.WorkBook,
	statusByKks: Map<string, CableBaseEntry>
) {
	const firstSheetRows = getRows(workbook, getFirstSheetName(workbook));
	const firstHeaderRow = firstSheetRows[0]?.map(normalizeHeader) ?? [];

	if (hasLegacyHeaders(firstHeaderRow)) {
		return parseLegacyRows(fileName, workbook);
	}

	return parsePriorityRows(fileName, workbook, statusByKks);
}

function aggregateInstallationGroups(rows: ParsedInstallationRow[]) {
	const groups = new Map<string, AggregatedInstallationGroup>();
	const seenKksKeys = new Set<string>();

	for (const row of rows) {
		const group = groups.get(row.groupName) ?? {
			name: row.groupName,
			sourceSheet: row.sourceSheet,
			sortOrder: groups.size,
			kksItems: [],
		};
		const kksKey = `${row.groupName}\n${normalizeKksKey(row.kksName)}`;

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

function readWorkbook(upload: Pick<WorkbookUpload, "buffer"> | { buffer: Uint8Array }) {
	return Xlsx.read(upload.buffer, {
		type: "buffer",
		cellDates: false,
		raw: false,
	});
}

async function getOptionalUpload(formData: FormData, fieldName: string) {
	if (!formData.get(fieldName)) return null;

	return ensureUploadFile(formData, fieldName);
}

function createSnapshotSummary(groups: AggregatedInstallationGroup[]) {
	const items = groups.flatMap((group) => group.kksItems);

	return {
		groupCount: groups.length,
		kksCount: items.length,
		cableCount: items.filter((item) => item.itemType === "cable").length,
		mechanismCount: items.filter((item) => item.itemType === "mechanism").length,
		baseMatchedCount: items.filter((item) => item.matchedInCableBase).length,
		baseDoneCount: items.filter((item) => item.isDone).length,
	};
}

function createInstallationChecksum(primaryUpload: WorkbookUpload, baseUpload: WorkbookUpload | null) {
	return createHash("sha256")
		.update(primaryUpload.buffer)
		.update(baseUpload?.buffer ?? "")
		.digest("hex");
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
		itemType: item.itemType,
		sourceSheet: item.sourceSheet,
		sourceRowIndex: item.sourceRowIndex,
		sourceColumnIndex: item.sourceColumnIndex,
		sourceColumnLabel: item.sourceColumnLabel,
		matchedInCableBase: item.matchedInCableBase,
		sortOrder: index,
		isDone: item.isDone,
		revision: 1,
		updatedAt: now,
		createdAt: now,
	}));
}

async function insertSnapshot(tx: DbTransaction, input: InstallationImportWriteInput) {
	const [createdSnapshot] = await tx
		.insert(installationSnapshots)
		.values({
			fileName: input.primaryUpload.file.name,
			fileType: input.primaryUpload.fileType,
			checksum: input.checksum,
			importedByUserId: input.session.id,
			rowCount: input.parsedRows.length,
			isActive: true,
			summary: input.summary,
			createdAt: input.now,
			updatedAt: input.now,
		})
		.returning();

	return createdSnapshot;
}

async function insertGroups(
	tx: DbTransaction,
	groups: AggregatedInstallationGroup[],
	snapshotId: string,
	now: Date
) {
	return tx
		.insert(installationKksGroups)
		.values(
			groups.map((group) => ({
				snapshotId,
				name: group.name,
				sourceSheet: group.sourceSheet,
				sortOrder: group.sortOrder,
				kksCount: group.kksItems.length,
				createdAt: now,
			}))
		)
		.returning({
			id: installationKksGroups.id,
			name: installationKksGroups.name,
		});
}

async function insertKksItems(tx: DbTransaction, input: InstallationImportWriteInput, snapshotId: string) {
	const insertedGroups = await insertGroups(tx, input.groups, snapshotId, input.now);
	const groupIdByName = new Map(insertedGroups.map((group) => [group.name, group.id]));
	const kksRows = input.groups.flatMap((group) => buildKksRows(group, groupIdByName, snapshotId, input.now));

	for (const chunk of chunkValues(kksRows, 500)) {
		await tx.insert(installationKksItems).values(chunk);
	}
}

async function replaceActiveInstallationData(tx: DbTransaction, input: InstallationImportWriteInput) {
	await tx.update(installationSnapshots).set({
		isActive: false,
		updatedAt: input.now,
	});

	const snapshot = await insertSnapshot(tx, input);
	await insertKksItems(tx, input, snapshot.id);

	return snapshot;
}

function createImportWriteInput(
	primaryUpload: WorkbookUpload,
	baseUpload: WorkbookUpload | null,
	session: AuthSession
) {
	const primaryWorkbook = readWorkbook(primaryUpload);
	const baseWorkbook = baseUpload ? readWorkbook(baseUpload) : null;
	const statusByKks = buildCableBaseIndex([primaryWorkbook, ...(baseWorkbook ? [baseWorkbook] : [])]);
	const parsedRows = parseInstallationRows(primaryUpload.file.name, primaryWorkbook, statusByKks);
	const groups = aggregateInstallationGroups(parsedRows);

	return {
		primaryUpload,
		session,
		parsedRows,
		groups,
		summary: createSnapshotSummary(groups),
		checksum: createInstallationChecksum(primaryUpload, baseUpload),
		now: new Date(),
	} satisfies InstallationImportWriteInput;
}

export async function importInstallationWorkbookFromFormData(formData: FormData, session: AuthSession) {
	const primaryUpload = await ensureUploadFile(formData);
	const baseUpload = await getOptionalUpload(formData, "baseFile");
	const input = createImportWriteInput(primaryUpload, baseUpload, session);
	const db = getDb();
	const snapshot = await db.transaction((tx) => replaceActiveInstallationData(tx, input));

	return {
		snapshotId: snapshot.id,
		fileName: snapshot.fileName,
		rowCount: snapshot.rowCount,
		...input.summary,
	};
}

export const __installationImportTestUtils = {
	buildCableBaseIndex,
	parseInstallationRows,
	readWorkbook,
};
