import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import type { BatchProgress, BatchResult, LoggerLike, ProcessBatchOptions } from "../contracts.js";
import type { SearchMarkerRecord } from "../search/index.js";
import { writeSearchIndex } from "../search/index.js";
import { loadDescriptionIndex } from "../services/pls-db.js";
import { convertSvgToDocx } from "./convert-svg-to-docx.js";

function renderProgressBar(
	done: number,
	total: number,
	success: number,
	failed: number,
	startTs: number
): string {
	const width = 28;
	const ratio = total === 0 ? 0 : done / total;
	const filled = Math.round(ratio * width);
	const bar = `${"=".repeat(filled)}${"-".repeat(Math.max(0, width - filled))}`;
	const elapsedSec = (Date.now() - startTs) / 1000;
	return `[${bar}] ${done}/${total} ok:${success} fail:${failed} ${elapsedSec.toFixed(1)}s`;
}

async function runWithConcurrency<T>(
	items: string[],
	concurrency: number,
	worker: (item: string, index: number, total: number) => Promise<T>
): Promise<T[]> {
	const results = Array.from<T | undefined>({ length: items.length });
	let nextIndex = 0;

	const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (true) {
			const current = nextIndex;
			nextIndex += 1;
			if (current >= items.length) {
				return;
			}
			results[current] = await worker(items[current], current, items.length);
		}
	});

	await Promise.all(workers);
	return results as T[];
}

export async function processBatch(
	options: ProcessBatchOptions,
	logger: LoggerLike,
	handlers: {
		onProgress?: (progress: BatchProgress) => void;
	} = {}
): Promise<BatchResult> {
	const inputDir = path.resolve(options.inputDir);
	const outputDir = path.resolve(options.outputDir);
	const svgDirCandidate = path.join(inputDir, "svg");
	let svgDir = inputDir;

	logger.log(`Input directory: ${inputDir}`);
	logger.log(`Output directory: ${outputDir}`);
	logger.log(`Concurrency: ${options.concurrency}`);

	try {
		const svgDirStats = await stat(svgDirCandidate);
		if (svgDirStats.isDirectory()) {
			svgDir = svgDirCandidate;
		}
	} catch {
		svgDir = inputDir;
	}

	logger.log(`SVG directory: ${svgDir}`);

	const descriptions = await loadDescriptionIndex(inputDir, logger);
	await mkdir(outputDir, { recursive: true });
	const entries = await readdir(svgDir, { withFileTypes: true });
	let files = entries
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".svg"))
		.map((entry) => entry.name)
		.sort((left, right) => left.localeCompare(right));

	if (options.match) {
		const needle = options.match.toLowerCase();
		files = files.filter((file) => file.toLowerCase().includes(needle));
	}
	if (options.limit) {
		files = files.slice(0, options.limit);
	}

	if (files.length === 0) {
		logger.log("No SVG files found for processing");
		const summary = "SVG-файлы не найдены.";
		return {
			success: 0,
			failed: 0,
			totalMarkers: 0,
			totalMismatches: 0,
			summary,
		};
	}

	logger.log(`Starting conversion. Files: ${files.length}`);

	sharp.concurrency(Math.max(1, Math.min(options.concurrency, 4)));

	const startedAt = Date.now();
	let completed = 0;
	let success = 0;
	let failed = 0;
	let totalMarkers = 0;
	let totalMismatches = 0;
	const searchRecords: SearchMarkerRecord[] = [];

	const emitProgress = (): void => {
		const line = renderProgressBar(completed, files.length, success, failed, startedAt);
		handlers.onProgress?.({
			completed,
			total: files.length,
			success,
			failed,
			totalMarkers,
			totalMismatches,
			line,
		});
	};

	emitProgress();

	await runWithConcurrency(files, options.concurrency, async (fileName, index, total) => {
		const svgPath = path.join(svgDir, fileName);
		const outName = `${path.parse(fileName).name}.docx`;
		const outputPath = path.join(outputDir, outName);
		const start = Date.now();

		try {
			const result = await convertSvgToDocx(svgPath, outputPath, descriptions);
			success += 1;
			totalMarkers += result.markers;
			totalMismatches += result.mismatches;
			searchRecords.push(...result.searchRecords);
			const elapsedMs = Date.now() - start;
			logger.log(
				`[${index + 1}/${total}] OK ${fileName} -> ${outName} | markers=${result.markers} | mismatches=${result.mismatches} | encoding=${result.encoding} | ${elapsedMs}ms`
			);
		} catch (error) {
			failed += 1;
			const elapsedMs = Date.now() - start;
			const message = error instanceof Error ? error.message : String(error);
			logger.log(`[${index + 1}/${total}] FAIL ${fileName} | ${elapsedMs}ms | ${message}`);
		} finally {
			completed += 1;
			emitProgress();
		}
	});

	await writeSearchIndex(inputDir, outputDir, searchRecords, logger);

	const summary = `Готово. успешно=${success}, провально=${failed}, всего_маркеров=${totalMarkers}, всего_несовпадений=${totalMismatches}`;
	logger.log(summary);
	return {
		success,
		failed,
		totalMarkers,
		totalMismatches,
		summary,
	};
}
