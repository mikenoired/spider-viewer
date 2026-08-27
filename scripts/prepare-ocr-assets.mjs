#!/usr/bin/env node

import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(import.meta.dirname, "..");
const outputRoot = path.join(projectRoot, "public", "vision");

function packageRoot(packageName) {
	return path.dirname(require.resolve(`${packageName}/package.json`));
}

async function languageModel(packageName, language) {
	const root = packageRoot(packageName);
	const directories = (await readdir(root, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory() && entry.name.endsWith("_best_int"))
		.map((entry) => entry.name);

	if (directories.length !== 1) {
		throw new Error(`Expected one best_int model in ${packageName}, found ${directories.length}`);
	}

	return path.join(root, directories[0], `${language}.traineddata.gz`);
}

const tesseractRoot = packageRoot("tesseract.js");
const coreRoot = packageRoot("tesseract.js-core");
const assets = [
	[path.join(tesseractRoot, "dist", "worker.min.js"), "tesseract/worker.min.js"],
	[path.join(tesseractRoot, "dist", "worker.min.js.LICENSE.txt"), "tesseract/worker.min.js.LICENSE.txt"],
	[path.join(coreRoot, "tesseract-core-lstm.wasm.js"), "tesseract-core/tesseract-core-lstm.wasm.js"],
	[
		path.join(coreRoot, "tesseract-core-simd-lstm.wasm.js"),
		"tesseract-core/tesseract-core-simd-lstm.wasm.js",
	],
	[
		path.join(coreRoot, "tesseract-core-relaxedsimd-lstm.wasm.js"),
		"tesseract-core/tesseract-core-relaxedsimd-lstm.wasm.js",
	],
	[await languageModel("@tesseract.js-data/eng", "eng"), "tessdata/eng.traineddata.gz"],
	[await languageModel("@tesseract.js-data/rus", "rus"), "tessdata/rus.traineddata.gz"],
	[path.join(tesseractRoot, "LICENSE.md"), "licenses/tesseract.js.txt"],
	[path.join(coreRoot, "LICENSE"), "licenses/tesseract.js-core.txt"],
];

await rm(outputRoot, { recursive: true, force: true });

for (const [source, relativeTarget] of assets) {
	const target = path.join(outputRoot, relativeTarget);
	await mkdir(path.dirname(target), { recursive: true });
	await cp(source, target);
}

process.stdout.write(`[ocr-assets] Prepared ${assets.length} files in public/vision\n`);
