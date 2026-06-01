import type { InstallationPhotoJob } from "./shared";

const photoDbName = "spider-viewer-installation-photo";
const photoDbVersion = 1;
const photoJobsStoreName = "jobs";

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
		};
		request.onerror = () => reject(request.error ?? createPhotoStorageError("Не удалось открыть фото-кэш."));
		request.onsuccess = () => resolve(request.result);
	});
}

function runPhotoStoreRequest<T>(
	mode: IDBTransactionMode,
	createRequest: (store: IDBObjectStore) => IDBRequest<T>
) {
	return openPhotoDb().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const transaction = db.transaction(photoJobsStoreName, mode);
				const request = createRequest(transaction.objectStore(photoJobsStoreName));

				transaction.oncomplete = () => db.close();
				transaction.onerror = () => {
					db.close();
					reject(transaction.error ?? createPhotoStorageError("Ошибка офлайн-хранилища фото."));
				};
				request.onerror = () =>
					reject(request.error ?? createPhotoStorageError("Ошибка офлайн-запроса фото."));
				request.onsuccess = () => resolve(request.result);
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
}
