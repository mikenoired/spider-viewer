import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import iconv from "iconv-lite";

import type { LoggerLike } from "../contracts.js";

const CSV_BOM = "\uFEFF";
const DEFAULT_CSV_SEPARATOR = ",";
const DATABASE_BASENAMES = ["PLS_ANA_CONF", "PLS_BIN_CONF"] as const;

type DbRecord = {
	source: string;
	pvid: string;
	baseKks?: string;
	description: string;
};

export type DescriptionIndex = {
	exactByPvid: Map<string, DbRecord>;
	byBaseKks: Map<string, DbRecord[]>;
};

function stripBom(input: string): string {
	return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}

function normalizeLineEndings(input: string): string {
	return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeIdentity(raw: string | undefined): string | undefined {
	if (!raw) {
		return undefined;
	}
	const normalized = raw
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^["']+|["']+$/g, "")
		.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function hasContent(row: string[]): boolean {
	return row.some((cell) => cell.trim().length > 0);
}

function escapeCsvCell(value: string, separator: string): string {
	const escaped = value.replace(/"/g, '""');
	if (
		escaped.includes(separator) ||
		escaped.includes('"') ||
		escaped.includes("\n") ||
		escaped.includes("\r")
	) {
		return `"${escaped}"`;
	}
	return escaped;
}

function formatCsvRow(values: string[], separator: string): string {
	return values.map((value) => escapeCsvCell(value, separator)).join(separator);
}

function parseDmpTable(content: string): { headers: string[]; rows: string[][] } {
	const lines = normalizeLineEndings(content).split("\n");
	const headerIndex = lines.findIndex((line) => line.startsWith("*#"));
	if (headerIndex === -1) {
		throw new Error("Не найдена строка заголовков *#...");
	}

	const headers = lines[headerIndex].slice(2).split("|");
	const rows: string[][] = [];

	for (let index = headerIndex + 1; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line || line.startsWith("*")) {
			continue;
		}

		const values = line.split("|");
		if (values.length < headers.length) {
			values.push(...Array.from({ length: headers.length - values.length }, () => ""));
		} else if (values.length > headers.length) {
			values.length = headers.length;
		}

		rows.push(values);
	}

	return { headers, rows };
}

function parseCsv(content: string): string[][] {
	const rows: string[][] = [];
	let currentRow: string[] = [];
	let currentCell = "";
	let inQuotes = false;

	for (let index = 0; index < content.length; index += 1) {
		const char = content[index];

		if (inQuotes) {
			if (char === '"') {
				const nextChar = content[index + 1];
				if (nextChar === '"') {
					currentCell += '"';
					index += 1;
				} else {
					inQuotes = false;
				}
			} else {
				currentCell += char;
			}
			continue;
		}

		if (char === '"') {
			inQuotes = true;
			continue;
		}

		if (char === ",") {
			currentRow.push(currentCell);
			currentCell = "";
			continue;
		}

		if (char === "\n") {
			currentRow.push(currentCell);
			rows.push(currentRow);
			currentRow = [];
			currentCell = "";
			continue;
		}

		if (char === "\r") {
			continue;
		}

		currentCell += char;
	}

	if (currentCell.length > 0 || currentRow.length > 0) {
		currentRow.push(currentCell);
		rows.push(currentRow);
	}

	return rows;
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function convertDmpToCsv(dmpPath: string, csvPath: string): Promise<number> {
	const buffer = await readFile(dmpPath);
	const decoded = iconv.decode(buffer, "cp1251");
	const { headers, rows } = parseDmpTable(decoded);
	const csvContent = `${CSV_BOM}${[headers, ...rows].map((row) => formatCsvRow(row, DEFAULT_CSV_SEPARATOR)).join("\n")}\n`;
	await writeFile(csvPath, csvContent, "utf8");
	return rows.length;
}

function getColumnIndex(headers: string[], name: string): number {
	return headers.indexOf(name);
}

function pickDescription(row: string[], descriptionIndex: number, textIndex: number): string | undefined {
	return normalizeIdentity(row[descriptionIndex]) ?? normalizeIdentity(row[textIndex]);
}

function scoreBaseCandidate(record: DbRecord): number {
	const base = record.baseKks;
	if (!base) {
		return 0;
	}

	if (record.pvid === base) {
		return 1000;
	}

	const suffix = record.pvid.startsWith(`${base}_`) ? record.pvid.slice(base.length) : "";
	if (suffix === "_XQ01") return record.source === "PLS_ANA_CONF" ? 950 : 900;
	if (suffix === "_F0") return 930;
	if (suffix === "_Z0") return 920;
	if (suffix === "_OU") return 910;
	if (suffix === "_B0") return 900;
	if (/^_XA\d+$/i.test(suffix)) return 860;
	if (/^_XG\d+$/i.test(suffix)) return 840;
	if (/^_ZV\d+$/i.test(suffix)) return 820;
	if (/^_XB\d+$/i.test(suffix)) return 300;
	if (/^_XM\d+$/i.test(suffix)) return 250;
	if (/^_ST\d+$/i.test(suffix)) return 200;
	if (/^_ER\d+$/i.test(suffix)) return 150;
	return Math.max(100, 700 - suffix.length);
}

export async function ensureDatabaseCsvs(inputDir: string, logger?: LoggerLike): Promise<string[]> {
	const csvPaths: string[] = [];

	for (const baseName of DATABASE_BASENAMES) {
		const dmpPath = path.join(inputDir, `${baseName}.dmp`);
		const csvPath = path.join(inputDir, `${baseName}.csv`);
		csvPaths.push(csvPath);

		const csvExists = await pathExists(csvPath);
		if (csvExists) {
			logger?.log(`DB CSV exists: ${path.basename(csvPath)}`);
			continue;
		}

		const dmpExists = await pathExists(dmpPath);
		if (!dmpExists) {
			throw new Error(`Не найден исходный файл БД: ${dmpPath}`);
		}

		const rowCount = await convertDmpToCsv(dmpPath, csvPath);
		logger?.log(`DB CSV created: ${path.basename(csvPath)} | rows=${rowCount}`);
	}

	return csvPaths;
}

export async function loadDescriptionIndex(inputDir: string, logger?: LoggerLike): Promise<DescriptionIndex> {
	const csvPaths = await ensureDatabaseCsvs(inputDir, logger);
	const exactByPvid = new Map<string, DbRecord>();
	const byBaseKks = new Map<string, DbRecord[]>();

	for (const csvPath of csvPaths) {
		const source = path.parse(csvPath).name;
		const rawCsv = await readFile(csvPath, "utf8");
		const rows = parseCsv(normalizeLineEndings(stripBom(rawCsv)));
		if (rows.length === 0) {
			continue;
		}

		const headers = rows[0];
		const pvidIndex = getColumnIndex(headers, "PVID");
		const descriptionIndex = getColumnIndex(headers, "PVDESCRIPTION");
		const textIndex = getColumnIndex(headers, "PVTEXT");
		const plcItemIdIndex = getColumnIndex(headers, "PLC_ITEMID");

		if (pvidIndex === -1 || descriptionIndex === -1 || textIndex === -1 || plcItemIdIndex === -1) {
			throw new Error(
				`В ${path.basename(csvPath)} отсутствуют обязательные колонки PVID/PVDESCRIPTION/PVTEXT/PLC_ITEMID`
			);
		}

		let loaded = 0;

		for (const row of rows.slice(1)) {
			if (!hasContent(row)) {
				continue;
			}

			const pvid = normalizeIdentity(row[pvidIndex]);
			const baseKks = normalizeIdentity(row[plcItemIdIndex]);
			const description = pickDescription(row, descriptionIndex, textIndex);
			if (!pvid || !description) {
				continue;
			}

			const record: DbRecord = {
				source,
				pvid,
				baseKks,
				description,
			};

			exactByPvid.set(pvid, record);
			if (baseKks) {
				const bucket = byBaseKks.get(baseKks) ?? [];
				bucket.push(record);
				byBaseKks.set(baseKks, bucket);
			}
			loaded += 1;
		}

		logger?.log(`DB index loaded: ${path.basename(csvPath)} | rows=${loaded}`);
	}

	return { exactByPvid, byBaseKks };
}

export function lookupDescription(index: DescriptionIndex, rawKks: string | undefined): string | undefined {
	const normalizedKks = normalizeIdentity(rawKks);
	if (!normalizedKks) {
		return undefined;
	}

	const exactMatch = index.exactByPvid.get(normalizedKks);
	if (exactMatch) {
		return exactMatch.description;
	}

	const baseMatches = index.byBaseKks.get(normalizedKks);
	if (!baseMatches || baseMatches.length === 0) {
		return undefined;
	}

	const sortedMatches = [...baseMatches].sort(
		(left, right) => scoreBaseCandidate(right) - scoreBaseCandidate(left)
	);
	return sortedMatches[0]?.description;
}
