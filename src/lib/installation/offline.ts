import type { InstallationBoardData, InstallationOfflineChange } from "./shared";

export type InstallationOfflineOutboxChange = InstallationOfflineChange & {
	createdAt: string;
};

const installationOfflineDbName = "spider-viewer-installation";
const installationOfflineDbVersion = 1;
const boardStoreName = "board";
const outboxStoreName = "outbox";
const activeBoardKey = "active";

function createOfflineError(message: string) {
	return new Error(message);
}

function getIndexedDb() {
	if (!("indexedDB" in window)) {
		throw createOfflineError("IndexedDB недоступен в этом браузере.");
	}

	return window.indexedDB;
}

function openInstallationDb() {
	return new Promise<IDBDatabase>((resolve, reject) => {
		const request = getIndexedDb().open(installationOfflineDbName, installationOfflineDbVersion);

		request.onupgradeneeded = () => {
			const db = request.result;

			if (!db.objectStoreNames.contains(boardStoreName)) {
				db.createObjectStore(boardStoreName);
			}

			if (!db.objectStoreNames.contains(outboxStoreName)) {
				db.createObjectStore(outboxStoreName, {
					keyPath: "clientMutationId",
				});
			}
		};
		request.onerror = () => reject(request.error ?? createOfflineError("Не удалось открыть offline-кэш."));
		request.onsuccess = () => resolve(request.result);
	});
}

function runStoreRequest<T>(
	mode: IDBTransactionMode,
	storeName: string,
	createRequest: (store: IDBObjectStore) => IDBRequest<T>
) {
	return openInstallationDb().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const transaction = db.transaction(storeName, mode);
				const request = createRequest(transaction.objectStore(storeName));

				transaction.oncomplete = () => db.close();
				transaction.onerror = () => {
					db.close();
					reject(transaction.error ?? createOfflineError("Ошибка offline-хранилища."));
				};
				request.onerror = () => reject(request.error ?? createOfflineError("Ошибка offline-запроса."));
				request.onsuccess = () => resolve(request.result);
			})
	);
}

export async function getCachedInstallationBoard() {
	const result = await runStoreRequest<InstallationBoardData | undefined>(
		"readonly",
		boardStoreName,
		(store) => store.get(activeBoardKey)
	);

	return result ?? null;
}

export async function saveCachedInstallationBoard(data: InstallationBoardData) {
	await runStoreRequest<IDBValidKey>("readwrite", boardStoreName, (store) => store.put(data, activeBoardKey));
}

export async function getInstallationOutboxChanges() {
	const changes = await runStoreRequest<InstallationOfflineOutboxChange[]>(
		"readonly",
		outboxStoreName,
		(store) => store.getAll()
	);

	return changes.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function queueInstallationOutboxChange(change: InstallationOfflineChange) {
	await runStoreRequest<IDBValidKey>("readwrite", outboxStoreName, (store) =>
		store.put({
			...change,
			createdAt: new Date().toISOString(),
		} satisfies InstallationOfflineOutboxChange)
	);
}

export async function removeInstallationOutboxChanges(clientMutationIds: string[]) {
	const db = await openInstallationDb();

	await new Promise<void>((resolve, reject) => {
		const transaction = db.transaction(outboxStoreName, "readwrite");
		const store = transaction.objectStore(outboxStoreName);

		for (const clientMutationId of clientMutationIds) {
			store.delete(clientMutationId);
		}

		transaction.oncomplete = () => {
			db.close();
			resolve();
		};
		transaction.onerror = () => {
			db.close();
			reject(transaction.error ?? createOfflineError("Не удалось очистить очередь offline-изменений."));
		};
	});
}

export function createInstallationClientMutationId(kksItemId: string) {
	const randomValue = crypto.randomUUID();

	return `${kksItemId}:${randomValue}`;
}
