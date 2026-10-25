import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function harness() {
	const listeners = new Map<string, (event: any) => void>();
	const stores = new Map<string, Map<string, Response>>();
	const key = (request: string | Request) =>
		typeof request === "string" ? new URL(request, "https://test.local").href : request.url;
	let offline = false;
	let now = Date.now();
	const caches = {
		async keys() {
			return [...stores.keys()];
		},
		async delete(name: string) {
			return stores.delete(name);
		},
		async open(name: string) {
			if (!stores.has(name)) stores.set(name, new Map());
			const store = stores.get(name)!;
			return {
				async match(request: string | Request) {
					return store.get(key(request))?.clone();
				},
				async put(request: string | Request, response: Response) {
					store.set(key(request), response.clone());
				},
				async delete(request: string | Request) {
					return store.delete(key(request));
				},
				async keys() {
					return [...store.keys()];
				},
				async addAll() {},
			};
		},
	};
	runInNewContext(readFileSync("public/sw.js", "utf8"), {
		self: {
			location: { origin: "https://test.local" },
			addEventListener: (name: string, fn: (event: any) => void) => listeners.set(name, fn),
			skipWaiting() {},
			clients: { async claim() {} },
		},
		caches,
		URL,
		Request,
		Response,
		Headers,
		Date: { now: () => now },
		fetch: async () => {
			if (offline) throw new TypeError("Failed to fetch");
			return new Response("network", { headers: { "Content-Type": "text/html" } });
		},
	});
	return {
		stores,
		setOffline() {
			offline = true;
		},
		advance(ms: number) {
			now += ms;
		},
		async message(data: unknown) {
			let done: Promise<unknown> = Promise.resolve();
			listeners.get("message")!({
				data,
				waitUntil: (promise: Promise<unknown>) => {
					done = promise;
				},
			});
			await done;
		},
		async fetch(path: string, mode = "cors") {
			let response: Promise<Response> | undefined;
			listeners.get("fetch")!({
				request: { method: "GET", url: new URL(path, "https://test.local").href, mode },
				respondWith: (value: Promise<Response>) => {
					response = value;
				},
			});
			return response;
		},
	};
}
it("never intercepts dynamic server functions, query strings or other origins", async () => {
	const worker = harness();
	expect(await worker.fetch("/_serverFn/abc?data=secret")).toBeUndefined();
	expect(await worker.fetch("/app/installation?filter=secret", "navigate")).toBeUndefined();
	expect(await worker.fetch("https://other.local/assets/app.js")).toBeUndefined();
	expect(worker.stores.size).toBe(0);
});
it("bounds shared static storage and expires old assets", async () => {
	const worker = harness();
	for (let i = 0; i < 140; i++) await worker.fetch(`/assets/app-${i}.js`);
	expect(worker.stores.get("spider-viewer-v2")?.size).toBe(128);
	worker.setOffline();
	expect(await (await worker.fetch("/assets/app-139.js"))?.text()).toBe("network");
	worker.advance(31 * 24 * 60 * 60 * 1000);
	await expect(worker.fetch("/assets/app-139.js")).rejects.toThrow("Failed to fetch");
});
it("preserves an offline page per account and removes it on logout/account switch", async () => {
	const worker = harness();
	const alice = "00000000-0000-4000-8000-000000000001";
	const bob = "00000000-0000-4000-8000-000000000002";
	await worker.message({ type: "set-session", userId: alice });
	await worker.message({ type: "set-session", userId: bob });
	expect(worker.stores.has(`spider-viewer-pages-v2:${alice}`)).toBe(false);
	worker.setOffline();
	expect(await (await worker.fetch("/app/installation", "navigate"))?.text()).toBe("network");
	await worker.message({ type: "clear-session" });
	expect(worker.stores.has(`spider-viewer-pages-v2:${bob}`)).toBe(false);
	await expect(worker.fetch("/app/installation", "navigate")).rejects.toThrow("Failed to fetch");
});
