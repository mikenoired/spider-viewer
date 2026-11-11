// Optional real-browser QA. Install Playwright outside application dependencies.
// PLAYWRIGHT_MODULE=file:///tmp/qa/node_modules/playwright/index.mjs node .../verify-document.mjs <PDF-or-image> <expected-pages> [private-output.json]
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
	headless: true,
	...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
		? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
		: {}),
});
try {
	const page = await browser.newPage();
	const origin = process.env.DOCUMENT_QA_URL || "http://localhost:3000";
	// A blank same-origin shell avoids application hydration, authentication and DB writes.
	await page.route("**/__document_qa", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: "<!doctype html><html><body><input type='file' id='scan'></body></html>",
		})
	);
	await page.goto(`${origin}/__document_qa`);
	await page.locator("#scan").setInputFiles(process.argv[2]);
	const result = await page.evaluate(async () => {
		const { recognizeTaskDocument } = await import("/src/lib/cable-map/document-ocr.ts");
		const pages = [];
		await recognizeTaskDocument(
			document.querySelector("#scan").files[0],
			(page) => {
				pages.push({ page: page.page, rotation: page.rotation, rows: page.rows, error: page.error });
			},
			() => {},
			new AbortController().signal
		);
		return pages;
	});
	assert.equal(result.length, Number(process.argv[3]));
	assert(
		result.every((page) => !page.error),
		"Some pages failed; inspect private output"
	);
	if (process.argv[4]) await writeFile(process.argv[4], JSON.stringify(result));
	process.stdout.write(
		`${JSON.stringify(result.map(({ page, rotation, rows, error }) => ({ page, rotation, candidates: rows.length, error })))}\n`
	);
} finally {
	await browser.close();
}
