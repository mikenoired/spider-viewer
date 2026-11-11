// Real-browser failure QA. DOCUMENT_QA_CASE=cancel or partial; install Playwright outside application dependencies.
// DOCUMENT_QA_CASE=cancel PLAYWRIGHT_MODULE=file:///tmp/qa/node_modules/playwright/index.mjs node .../verify-failures.mjs <PDF>
import assert from "node:assert/strict";

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
	const result = await page.evaluate(
		async ({ testCase }) => {
			const file = document.querySelector("#scan").files[0];
			const { recognizeTaskDocument } = await import("/src/lib/cable-map/document-ocr.ts");
			const pages = [];
			const controller = new AbortController();
			let aborted = false;
			if (testCase === "cancel") {
				try {
					await recognizeTaskDocument(
						file,
						(page) => {
							pages.push({ page: page.page, error: page.error });
							controller.abort();
						},
						() => {},
						controller.signal,
						90
					);
				} catch (error) {
					if (!controller.signal.aborted) throw error;
					aborted = true;
				}
				return { pages, aborted };
			}
			const source = await (await fetch("/src/lib/cable-map/document-ocr.ts")).text();
			const path = [...source.matchAll(/import\(\s*["']([^"']*pdfjs-dist[^"']*)["']\s*\)/g)]
				.map((m) => m[1])
				.find((path) => !path.includes("worker") && !path.includes("renderer"));
			if (!path) throw new Error("PDF.js module path not found");
			const pdf = await import(path);
			const paths = [...source.matchAll(/import\(\s*["']([^"']*pdfjs-dist[^"']*)["']\s*\)/g)].map(
				(m) => m[1]
			);
			pdf.GlobalWorkerOptions.workerSrc = (
				await import(paths.find((path) => path.includes("worker")))
			).default;
			pdf.GlobalWorkerOptions.rendererSrc = (
				await import(paths.find((path) => path.includes("renderer")))
			).default;
			const probeTask = pdf.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
			const probe = await probeTask.promise;
			const prototype = Object.getPrototypeOf(probe);
			const getPage = prototype.getPage;
			const count = Object.getOwnPropertyDescriptor(prototype, "numPages");
			Object.defineProperty(prototype, "numPages", {
				...count,
				get() {
					return Math.min(3, count.get.call(this));
				},
			});
			prototype.getPage = function (number) {
				if (number === 2) throw new Error("Controlled page failure");
				return getPage.call(this, number);
			};
			try {
				await recognizeTaskDocument(
					file,
					(page) => pages.push({ page: page.page, error: page.error, rows: page.rows.length }),
					() => {},
					controller.signal,
					90
				);
			} finally {
				prototype.getPage = getPage;
				Object.defineProperty(prototype, "numPages", count);
				await probeTask.destroy();
			}
			return { pages, aborted };
		},
		{ testCase: process.env.DOCUMENT_QA_CASE }
	);
	if (process.env.DOCUMENT_QA_CASE === "cancel") {
		assert.equal(result.pages.length, 1);
		assert(result.aborted);
	} else {
		assert.equal(result.pages.length, 3);
		assert.equal(result.pages[0].error, null);
		assert.match(result.pages[1].error, /Controlled page failure/);
		assert.equal(result.pages[2].error, null);
	}
	process.stdout.write(JSON.stringify(result) + "\n");
} finally {
	await browser.close();
}
