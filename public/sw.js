const cacheName = "spider-viewer-v2";
const sessionCacheName = "spider-viewer-session-v2";
const pageCachePrefix = "spider-viewer-pages-v2:";
const maxStaticEntries = 128;
const maxPageEntries = 4;
const staticMaxAgeMs = 30 * 24 * 60 * 60 * 1000;
const pageMaxAgeMs = 24 * 60 * 60 * 1000;
const pagePaths = new Set(["/app", "/app/", "/app/installation"]);
const sessionKey = new URL("/__offline_user__", self.location.origin).href;
let sessionChange = Promise.resolve();

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(cacheName).then((cache) => cache.addAll(["/manifest.webmanifest", "/favicon.ico"]))
	);
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			for (const name of await caches.keys()) {
				if (
					name.startsWith("spider-viewer-") &&
					name !== cacheName &&
					name !== sessionCacheName &&
					!name.startsWith(pageCachePrefix)
				) {
					await caches.delete(name);
				}
			}
			await self.clients.claim();
		})()
	);
});

self.addEventListener("message", (event) => {
	if (event.data?.type !== "set-session" && event.data?.type !== "clear-session") return;
	const userId = event.data.type === "set-session" ? event.data.userId : null;
	if (userId !== null && (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId))) return;
	sessionChange = sessionChange
		.catch(() => undefined)
		.then(async () => {
			const metadata = await caches.open(sessionCacheName);
			if (userId) await metadata.put(sessionKey, new Response(userId));
			else await metadata.delete(sessionKey);
			for (const name of await caches.keys()) {
				if (name.startsWith(pageCachePrefix) && name !== `${pageCachePrefix}${userId}`)
					await caches.delete(name);
			}
			if (userId) {
				const cache = await caches.open(`${pageCachePrefix}${userId}`);
				const request = new Request(new URL("/app/installation", self.location.origin), {
					credentials: "include",
				});
				if (!(await cache.match(request))) {
					await fetch(request)
						.then(async (response) => {
							if (response.ok && !response.redirected)
								await putCached(cache, request, response, maxPageEntries);
						})
						.catch(() => undefined);
				}
			}
		});
	event.waitUntil(sessionChange);
});

async function getUserId() {
	await sessionChange;
	const entry = await (await caches.open(sessionCacheName)).match(sessionKey);
	return entry ? entry.text() : null;
}

function isStaticUrl(url) {
	return (
		!url.search &&
		(url.pathname.startsWith("/assets/") ||
			url.pathname.startsWith("/vision/") ||
			["/favicon.ico", "/manifest.webmanifest"].includes(url.pathname))
	);
}

self.addEventListener("fetch", (event) => {
	const request = event.request;
	const url = new URL(request.url);
	if (request.method !== "GET" || url.origin !== self.location.origin) return;
	// Server functions, API responses and arbitrary query strings must never enter the shared cache.
	if (!isStaticUrl(url) && !(request.mode === "navigate" && !url.search && pagePaths.has(url.pathname)))
		return;
	event.respondWith(handleGetRequest(request));
});

async function putCached(cache, request, response, limit) {
	const headers = new Headers(response.headers);
	headers.set("x-spider-cached-at", String(Date.now()));
	headers.delete("content-encoding");
	headers.delete("content-length");
	await cache.put(request, new Response(await response.arrayBuffer(), { status: response.status, headers }));
	const keys = await cache.keys();
	for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
}

async function readCached(cache, request, maxAge) {
	const response = await cache.match(request);
	if (!response) return null;
	// Old pre-cached/OCR assets may have no timestamp; they are explicitly prepared resources.
	const storedAt = Number(response.headers.get("x-spider-cached-at"));
	if (storedAt && Date.now() - storedAt > maxAge) {
		await cache.delete(request);
		return null;
	}
	return response;
}

async function handleGetRequest(request) {
	const isPage = request.mode === "navigate";
	const userId = isPage ? await getUserId() : null;
	const cache = await caches.open(isPage && userId ? `${pageCachePrefix}${userId}` : cacheName);
	try {
		const response = await fetch(request);
		if (response.ok && !response.redirected && (!isPage || userId)) {
			// Cache failure/quota must not turn a successful network response into an offline failure.
			await putCached(cache, request, response.clone(), isPage ? maxPageEntries : maxStaticEntries).catch(
				() => undefined
			);
		}
		return response;
	} catch (error) {
		if (isPage && !userId) throw error;
		const cached = await readCached(cache, request, isPage ? pageMaxAgeMs : staticMaxAgeMs);
		if (cached) return cached;
		if (isPage) {
			const shell = await readCached(
				cache,
				new URL("/app/installation", self.location.origin).href,
				pageMaxAgeMs
			);
			if (shell) return shell;
		}
		throw error;
	}
}
