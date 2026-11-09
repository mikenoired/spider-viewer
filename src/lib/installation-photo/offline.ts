import type { InstallationPhotoJob } from "./shared";

const photoDbName = "spider-viewer-installation-photo";
const photoDbVersion = 2;
const photoJobsStoreName = "jobs";
const photoUploadsStoreName = "uploads";

export type PendingPhotoUpload = {
	id: string;
	userId: string;
	snapshotId: string;
	fileName: string;
	image: Blob;
};

function createPhotoStorageError(message: string) {
	return new Error(message);
}

function getIndexedDb() {
	if (!("indexedDB" in window)) {
		throw createPhotoStorageError("IndexedDB недоступен в этом браузере.");
	}

	return window.indexedDB;
}

function openPhotoDb() {
	return new Promise<IDBDatabase>((resolve, reject) => {
		const request = getIndexedDb().open(photoDbName, photoDbVersion);

		request.onupgradeneeded = () => {
			const db = request.result;

			if (!db.objectStoreNames.contains(photoJobsStoreName)) {
				db.createObjectStore(photoJobsStoreName, {
					keyPath: "id",
				});
			}
			if (!db.objectStoreNames.contains(photoUploadsStoreName))
				db.createObjectStore(photoUploadsStoreName, { keyPath: "id" });
		};
		request.onerror = () => reject(request.error ?? createPhotoStorageError("Не удалось открыть фото-кэш."));
		request.onsuccess = () => resolve(request.result);
	});
}

function runPhotoStoreRequest<T>(
	mode: IDBTransactionMode,
	createRequest: (store: IDBObjectStore) => IDBRequest<T>,
	storeName = photoJobsStoreName
) {
	return openPhotoDb().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const transaction = db.transaction(storeName, mode);
				const request = createRequest(transaction.objectStore(storeName));
				let result: T;

				transaction.oncomplete = () => {
					db.close();
					resolve(result);
				};
				transaction.onerror = transaction.onabort = () => {
					db.close();
					reject(transaction.error ?? createPhotoStorageError("Ошибка офлайн-хранилища фото."));
				};
				request.onerror = () =>
					reject(request.error ?? createPhotoStorageError("Ошибка офлайн-запроса фото."));
				request.onsuccess = () => {
					result = request.result;
				};
			})
	);
}

export async function getInstallationPhotoJobs(snapshotId: string) {
	const jobs = await runPhotoStoreRequest<InstallationPhotoJob[]>("readonly", (store) => store.getAll());

	return jobs
		.filter((job) => job.snapshotId === snapshotId)
		.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function saveInstallationPhotoJob(job: InstallationPhotoJob) {
	await runPhotoStoreRequest<IDBValidKey>("readwrite", (store) => store.put(job));
}

export async function removeInstallationPhotoJob(jobId: string) {
	await runPhotoStoreRequest<undefined>("readwrite", (store) => store.delete(jobId));
	await removePendingPhotoUpload(jobId);
}

export async function queuePhotoUpload(upload: PendingPhotoUpload) {
	await runPhotoStoreRequest("readwrite", (store) => store.put(upload), photoUploadsStoreName);
}

export async function getPendingPhotoUploads(userId: string, snapshotId?: string) {
	const uploads = await runPhotoStoreRequest<PendingPhotoUpload[]>(
		"readonly",
		(store) => store.getAll(),
		photoUploadsStoreName
	);
	return uploads.filter(
		(upload) => upload.userId === userId && (!snapshotId || upload.snapshotId === snapshotId)
	);
}

export async function removePendingPhotoUpload(id: string) {
	await runPhotoStoreRequest("readwrite", (store) => store.delete(id), photoUploadsStoreName);
}
