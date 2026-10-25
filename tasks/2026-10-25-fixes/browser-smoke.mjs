// Optional browser runner. Install Playwright outside the app and set SPIDER_BROWSER_TOOLS to its directory.
// Run only against a local server configured with the same disposable APP_TEST_DATABASE_URL and test JWT secret.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { SignJWT } from "jose";
import postgres from "postgres";

import { AUTH_COOKIE_NAME } from "../../src/lib/auth/shared.ts";
import * as schema from "../../src/lib/db/schema.ts";

const testUrl = process.env.APP_TEST_DATABASE_URL;
assert.ok(
	testUrl && /test/i.test(new URL(testUrl).pathname),
	"Explicit disposable APP_TEST_DATABASE_URL required"
);
const base = process.env.SPIDER_TEST_BASE_URL ?? "http://127.0.0.1:4301";
assert.equal(new URL(base).hostname, "127.0.0.1");
const { chromium } = await import(
	pathToFileURL(path.join(process.env.SPIDER_BROWSER_TOOLS, "node_modules/playwright/index.mjs")).href
);
const client = postgres(testUrl, { prepare: false, onnotice: () => undefined });
const db = drizzle(client, { schema });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const log = (message) => process.stdout.write(`${message}\n`);
try {
	const alice = randomUUID();
	const bob = randomUUID();
	await db.insert(schema.users).values(
		[alice, bob].map((id) => ({
			id,
			login: `browser-${id}`,
			passwordHash: "unused",
			role: "super-admin",
			department: "tai",
		}))
	);
	await db.update(schema.installationSnapshots).set({ isActive: false });
	const [snapshot] = await db
		.insert(schema.installationSnapshots)
		.values({
			fileName: "browser-fixture.xlsx",
			fileType: "xlsx",
			checksum: randomUUID(),
			importedByUserId: alice,
			isActive: true,
			summary: { groupCount: 1, kksCount: 1 },
		})
		.returning();
	const [group] = await db
		.insert(schema.installationKksGroups)
		.values({ snapshotId: snapshot.id, name: "BROWSER-GROUP", kksCount: 1 })
		.returning();
	const [item] = await db
		.insert(schema.installationKksItems)
		.values({ snapshotId: snapshot.id, groupId: group.id, name: "1HV44K190" })
		.returning();
	async function signIn(userId) {
		const token = await new SignJWT({ sessionVersion: 0 })
			.setProtectedHeader({ alg: "HS256" })
			.setSubject(userId)
			.setIssuedAt()
			.setExpirationTime("1h")
			.sign(new TextEncoder().encode("spider-browser-test-secret-for-local-use"));
		await context.addCookies([
			{ name: AUTH_COOKIE_NAME, value: token, url: base, httpOnly: true, sameSite: "Lax" },
		]);
	}
	await signIn(alice);
	const page = await context.newPage();
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await page.goto(`${base}/app/installation`);
	await page.getByRole("button", { name: "Обновить", exact: true }).waitFor();
	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
	const responsePromise = page.waitForResponse(
		(response) => response.url().includes("/_serverFn/") && response.request().method() === "GET"
	);
	await page.getByRole("button", { name: "Обновить", exact: true }).click();
	const response = await responsePromise;
	const rpcUrl = response.url();
	assert.ok((await response.text()).includes("browser-fixture.xlsx"));
	const anonymous = await browser.newContext({ serviceWorkers: "block" });
	const headers = {
		"x-tsr-serverFn": "true",
		"sec-fetch-site": "same-origin",
		"origin": base,
		"referer": `${base}/app/installation`,
	};
	const denied = await anonymous.request.get(rpcUrl, { headers });
	const deniedBody = await denied.text();
	// TanStack transports serialized server-function exceptions with HTTP 200.
	assert.ok(deniedBody.includes("Требуется авторизация."));
	assert.ok(!deniedBody.includes("browser-fixture.xlsx"));
	const ids = new Map();
	for (const file of readdirSync("dist/server/assets").filter((name) => name.startsWith("functions-"))) {
		const source = readFileSync(path.join("dist/server/assets", file), "utf8");
		for (const match of source.matchAll(
			/id: "([a-f0-9]+)",\s+name: "(getDashboardData|getInstallationDashboardData|getInstallationBoardData)"/g
		))
			ids.set(match[2], match[1]);
	}
	assert.equal(ids.size, 3);
	for (const [name, id] of ids) {
		const target = new URL(rpcUrl);
		target.pathname = `/_serverFn/${id}`;
		assert.equal(
			(await context.request.get(target.href, { headers })).status(),
			200,
			`${name} authenticated`
		);
		assert.ok(
			(await (await anonymous.request.get(target.href, { headers })).text()).includes(
				"Требуется авторизация."
			),
			`${name} unauthenticated`
		);
	}
	await anonymous.close();
	log("PASS: all three read RPCs accept authenticated calls and reject direct unauthenticated HTTP calls.");

	await page.getByText("BROWSER-GROUP", { exact: true }).first().click();
	const toggle = page.getByRole("switch", { name: "Изменить готовность 1HV44K190" });
	await toggle.waitFor();
	// Simulate a transport failure before navigator.onLine changes.
	await page.route("**/_serverFn/**", (route) =>
		route.request().method() === "POST" ? route.abort("failed") : route.continue()
	);
	assert.equal(await page.evaluate(() => navigator.onLine), true);
	await toggle.click();
	await page.waitForFunction(() => document.body.textContent.includes("Офлайн-изменений: 1"));
	await page.unroute("**/_serverFn/**");
	await context.setOffline(true);
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.getByRole("button", { name: "Обновить", exact: true }).waitFor();
	await page.waitForFunction(() => document.body.textContent.includes("Офлайн-изменений: 1"));
	log("PASS: a failed POST with navigator.onLine=true survives offline Chromium reload in IndexedDB.");
	await context.setOffline(false);
	await page.waitForFunction(() => !document.body.textContent.includes("Офлайн-изменений: 1"));
	const pending = await db
		.select()
		.from(schema.installationPendingChanges)
		.where(eq(schema.installationPendingChanges.kksItemId, item.id));
	assert.equal(pending.length, 1);
	assert.equal(pending[0].userId, alice);
	log("PASS: reconnect submits the queued change once with the original author.");

	await signIn(bob);
	await page.goto(`${base}/app/installation`);
	await page.getByRole("button", { name: "Меню пользователя" }).waitFor();
	await page.waitForFunction(
		(oldUser) =>
			caches.keys().then((names) => !names.some((name) => name === `spider-viewer-pages-v2:${oldUser}`)),
		alice
	);
	const staticKeys = await page.evaluate(async () =>
		(await (await caches.open("spider-viewer-v2")).keys()).map((request) => request.url)
	);
	assert.ok(staticKeys.every((url) => !url.includes("/_serverFn/") && !new URL(url).search));
	log(
		"PASS: account switch drops the old shell; dynamic/private RPC responses are absent from the shared cache."
	);
	await page.getByRole("button", { name: "Меню пользователя" }).click();
	await page.getByRole("menuitem", { name: "Выйти из аккаунта" }).click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Подтвердить", exact: true }).click();
	await page.waitForURL("**/login");
	await page.waitForFunction(() =>
		caches.keys().then((names) => !names.some((name) => name.startsWith("spider-viewer-pages-v2:")))
	);
	assert.deepEqual(pageErrors, []);
	log("PASS: logout clears private shells; no browser page errors.");
} finally {
	await context.close();
	await browser.close();
	await client.end();
}
