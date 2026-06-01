export const installationPhotoOcrAssetUrls = [
	"/vision/tesseract/worker.min.js",
	"/vision/tesseract-core/tesseract-core-lstm.wasm",
	"/vision/tesseract-core/tesseract-core-lstm.wasm.js",
	"/vision/tesseract-core/tesseract-core-relaxedsimd-lstm.wasm",
	"/vision/tesseract-core/tesseract-core-relaxedsimd-lstm.wasm.js",
	"/vision/tesseract-core/tesseract-core-simd-lstm.wasm",
	"/vision/tesseract-core/tesseract-core-simd-lstm.wasm.js",
	"/vision/tessdata/eng.traineddata.gz",
	"/vision/tessdata/rus.traineddata.gz",
] as const;

const installationPhotoOcrCacheName = "spider-viewer-v1";

export type InstallationPhotoAssetProgress = {
	loaded: number;
	total: number;
	percent: number;
};

export type InstallationPhotoAssetStatus = "checking" | "ready" | "missing" | "unsupported";

export type InstallationPhotoAssetState = {
	status: InstallationPhotoAssetStatus;
	loaded: number;
	total: number;
	missingUrls: string[];
};

function createAssetProgress(loaded: number, total: number) {
	return {
		loaded,
		total,
		percent: Math.round((loaded / total) * 100),
	} satisfies InstallationPhotoAssetProgress;
}

function createAssetState(missingUrls: string[]) {
	const total = installationPhotoOcrAssetUrls.length;

	return {
		status: missingUrls.length === 0 ? "ready" : "missing",
		loaded: total - missingUrls.length,
		total,
		missingUrls,
	} satisfies InstallationPhotoAssetState;
}

function getUnsupportedAssetState() {
	return {
		status: "unsupported",
		loaded: 0,
		total: installationPhotoOcrAssetUrls.length,
		missingUrls: [...installationPhotoOcrAssetUrls],
	} satisfies InstallationPhotoAssetState;
}

function canUseOfflineOcrStorage() {
	return typeof window !== "undefined" && "caches" in window && "serviceWorker" in navigator;
}

async function waitForOfflineCacheReady() {
	await navigator.serviceWorker.ready;
}

async function fetchOcrAsset(url: string) {
	const response = await fetch(url, {
		cache: "reload",
	});

	if (!response.ok) {
		throw new Error(`Не удалось подготовить OCR-актив: ${url}`);
	}

	return response;
}

async function cacheOcrAsset(url: string) {
	const response = await fetchOcrAsset(url);
	const cache = await caches.open(installationPhotoOcrCacheName);

	await cache.put(url, response.clone());
}

async function isOcrAssetCached(url: string) {
	const cache = await caches.open(installationPhotoOcrCacheName);
	const cachedResponse = await cache.match(url);

	return Boolean(cachedResponse);
}

export async function getInstallationPhotoOcrAssetState() {
	if (!canUseOfflineOcrStorage()) return getUnsupportedAssetState();

	await waitForOfflineCacheReady();

	const checks = await Promise.all(
		installationPhotoOcrAssetUrls.map(async (url) => ({
			url,
			cached: await isOcrAssetCached(url),
		}))
	);
	const missingUrls = checks.filter((check) => !check.cached).map((check) => check.url);

	return createAssetState(missingUrls);
}

export function createCheckingInstallationPhotoOcrAssetState() {
	return {
		status: "checking",
		loaded: 0,
		total: installationPhotoOcrAssetUrls.length,
		missingUrls: [...installationPhotoOcrAssetUrls],
	} satisfies InstallationPhotoAssetState;
}

export async function warmInstallationPhotoOcrAssets(
	onProgress: (progress: InstallationPhotoAssetProgress) => void
) {
	if (!canUseOfflineOcrStorage()) {
		throw new Error("Браузер не поддерживает офлайн-кэш для OCR.");
	}

	await waitForOfflineCacheReady();

	let loaded = 0;
	const total = installationPhotoOcrAssetUrls.length;
	const fetches = installationPhotoOcrAssetUrls.map((url) =>
		cacheOcrAsset(url).then(() => {
			loaded += 1;
			onProgress(createAssetProgress(loaded, total));
		})
	);

	onProgress(createAssetProgress(loaded, total));
	await Promise.all(fetches);
}
