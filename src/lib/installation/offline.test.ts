import { beforeEach, describe, expect, it } from "bun:test";

import { IDBFactory } from "fake-indexeddb";

import {
	getCachedInstallationBoard,
	getInstallationOutboxChanges,
	queueInstallationOutboxChange,
	saveCachedInstallationBoard,
} from "./offline";
import type { InstallationBoardData } from "./shared";

beforeEach(() => {
	Object.defineProperty(window, "indexedDB", { configurable: true, value: new IDBFactory() });
});
const change = (snapshotId: string, id: string) => ({
	snapshotId,
	clientMutationId: id,
	groupId: "group",
	kksItemId: id,
	baseDone: false,
	desiredDone: true,
});

describe("installation offline ownership and snapshots", () => {
	it("keeps users' queues and cached boards separate", async () => {
		await queueInstallationOutboxChange(change("snapshot", "a"), "alice");
		await queueInstallationOutboxChange(change("snapshot", "b"), "bob");
		expect((await getInstallationOutboxChanges("alice")).map((row) => row.clientMutationId)).toEqual(["a"]);
		expect((await getInstallationOutboxChanges("bob")).map((row) => row.clientMutationId)).toEqual(["b"]);
		const board: InstallationBoardData = {
			snapshot: null,
			columns: { not_started: [], in_progress: [], done: [] },
			processingGroups: [],
		};
		await saveCachedInstallationBoard(board, "alice");
		expect(await getCachedInstallationBoard("bob")).toBeNull();
		expect(await getCachedInstallationBoard("alice")).toEqual(board);
	});
	it("does not let an old snapshot block the active queue or discard its stored changes", async () => {
		await queueInstallationOutboxChange(change("old", "old"), "alice");
		await queueInstallationOutboxChange(change("new", "new"), "alice");
		expect((await getInstallationOutboxChanges("alice", "new")).map((row) => row.clientMutationId)).toEqual([
			"new",
		]);
		expect(await getInstallationOutboxChanges("alice")).toHaveLength(2);
	});
	it("preserves legacy unowned entries without attributing them to the next login", async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = window.indexedDB.open("spider-viewer-installation", 1);
			request.onupgradeneeded = () => {
				request.result.createObjectStore("board");
				request.result.createObjectStore("outbox", { keyPath: "clientMutationId" });
			};
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);
		});
		await new Promise<void>((resolve) => {
			const tx = db.transaction("outbox", "readwrite");
			tx.objectStore("outbox").put({ ...change("snapshot", "legacy"), createdAt: "2026-01-01" });
			tx.oncomplete = () => resolve();
		});
		db.close();
		expect(await getInstallationOutboxChanges("alice")).toEqual([]);
		expect(await getInstallationOutboxChanges("bob")).toEqual([]);
	});
});
