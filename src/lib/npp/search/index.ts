import { access, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { LoggerLike } from "../contracts.js";

export type SearchMarkerRecord = {
	frameName: string;
	markerIndex: number;
	submodel: string;
	kks?: string;
	title: string;
	description?: string;
};

export type SearchIndexData = {
	createdAt: string;
	inputDir: string;
	outputDir: string;
	records: SearchMarkerRecord[];
};

export class InvalidSearchIndexError extends Error {
	constructor(
		message: string,
		public readonly filePath: string
	) {
		super(message);
		this.name = "InvalidSearchIndexError";
	}
}

function normalizeText(value: string): string {
	return value.trim().toLowerCase();
}

export function getSearchIndexPath(outputDir: string): string {
	return path.join(outputDir, "search-index.json");
}

export async function writeSearchIndex(
	inputDir: string,
	outputDir: string,
	records: SearchMarkerRecord[],
	logger?: LoggerLike
): Promise<string> {
	const filePath = getSearchIndexPath(outputDir);
	const tempFilePath = `${filePath}.tmp`;
	const payload: SearchIndexData = {
		createdAt: new Date().toISOString(),
		inputDir,
		outputDir,
		records: records
			.filter((record) => record.submodel.trim().length > 0)
			.sort((left, right) => {
				const frameCompare = left.frameName.localeCompare(right.frameName);
				if (frameCompare !== 0) {
					return frameCompare;
				}
				return left.markerIndex - right.markerIndex;
			}),
	};

	await writeFile(tempFilePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	await rename(tempFilePath, filePath);
	logger?.log(`Search index created: ${path.basename(filePath)} | records=${payload.records.length}`);
	return filePath;
}

export async function hasSearchIndex(outputDir: string): Promise<boolean> {
	try {
		await access(getSearchIndexPath(outputDir));
		return true;
	} catch {
		return false;
	}
}

export async function readSearchIndex(outputDir: string): Promise<SearchIndexData> {
	const filePath = getSearchIndexPath(outputDir);
	const content = await readFile(filePath, "utf8");
	try {
		return JSON.parse(content) as SearchIndexData;
	} catch {
		throw new InvalidSearchIndexError(
			`Поисковый индекс поврежден: ${path.basename(filePath)}. Перезапустите обработку для пересоздания индекса.`,
			filePath
		);
	}
}

export async function findMissingSearchFiles(inputDir: string, outputDir: string): Promise<string[]> {
	const requiredPaths = [
		{ path: path.join(inputDir, "PLS_ANA_CONF.dmp"), label: "PLS_ANA_CONF.dmp" },
		{ path: path.join(inputDir, "PLS_BIN_CONF.dmp"), label: "PLS_BIN_CONF.dmp" },
		{ path: path.join(inputDir, "svg"), label: "input/svg" },
		{ path: getSearchIndexPath(outputDir), label: "search-index.json" },
	];

	const missing: string[] = [];
	for (const item of requiredPaths) {
		try {
			await access(item.path);
		} catch {
			missing.push(item.label);
		}
	}
	return missing;
}

export function listSubmodels(
	index: SearchIndexData,
	query?: string
): Array<{ submodel: string; count: number }> {
	const counter = new Map<string, number>();
	for (const record of index.records) {
		counter.set(record.submodel, (counter.get(record.submodel) ?? 0) + 1);
	}

	const needle = query ? normalizeText(query) : "";
	return [...counter.entries()]
		.map(([submodel, count]) => ({ submodel, count }))
		.filter((item) => (needle ? normalizeText(item.submodel).includes(needle) : true))
		.sort((left, right) => {
			const countCompare = right.count - left.count;
			return countCompare !== 0 ? countCompare : left.submodel.localeCompare(right.submodel);
		});
}

export function searchBySubmodel(index: SearchIndexData, submodel: string): SearchMarkerRecord[] {
	const needle = normalizeText(submodel);
	return index.records
		.filter((record) => normalizeText(record.submodel) === needle)
		.sort((left, right) => {
			const frameCompare = left.frameName.localeCompare(right.frameName);
			if (frameCompare !== 0) {
				return frameCompare;
			}
			return left.markerIndex - right.markerIndex;
		});
}
