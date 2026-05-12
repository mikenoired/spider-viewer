const cacheName = "spider-viewer-v1";
const shellUrls = ["/", "/app", "/app/installation", "/login", "/manifest.webmanifest", "/favicon.ico"];

self.addEventListener("install", (event) => {
	event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(shellUrls)));
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key))))
	);
	self.clients.claim();
});

self.addEventListener("fetch", (event) => {
	const request = event.request;

	if (request.method !== "GET") return;

	event.respondWith(handleGetRequest(request));
});

async function handleGetRequest(request) {
	const cache = await caches.open(cacheName);

	try {
		const response = await fetch(request);

		if (response.ok) {
			cache.put(request, response.clone());
		}

		return response;
	} catch {
		const cachedResponse = await cache.match(request);

		if (cachedResponse) return cachedResponse;

		if (request.mode === "navigate") {
			return (await cache.match("/app/installation")) ?? cache.match("/app") ?? cache.match("/");
		}

		throw new Error("Offline cache miss.");
	}
}
