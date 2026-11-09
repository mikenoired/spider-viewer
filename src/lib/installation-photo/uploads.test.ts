import { beforeEach, describe, expect, it } from "bun:test";
import { Blob as NativeBlob } from "node:buffer";

import { IDBFactory } from "fake-indexeddb";

import { getPendingPhotoUploads, queuePhotoUpload } from "./offline";
import { syncPhotoUploads } from "./uploads";
import { archiveInstallationPhoto } from "./uploads.server";

beforeEach(() => {
	Object.defineProperty(window, "indexedDB", { configurable: true, value: new IDBFactory() });
});

describe("photo archive queue", () => {
	it("keeps failed uploads for retry, includes older snapshots and never sends another user's photo", async () => {
		// fake-indexeddb uses native structuredClone; happy-dom's Blob is not cloneable by it.
		const image = new NativeBlob(["photo"], { type: "image/jpeg" });
		await queuePhotoUpload({ id: "own", userId: "alice", snapshotId: "one", fileName: "photo.jpg", image });
		await queuePhotoUpload({ id: "other", userId: "bob", snapshotId: "one", fileName: "other.jpg", image });
		await queuePhotoUpload({ id: "old", userId: "alice", snapshotId: "old", fileName: "old.jpg", image });
		let failedAttempts = 0;
		await expect(
			syncPhotoUploads("alice", async () => {
				failedAttempts++;
				throw new Error("offline");
			})
		).rejects.toThrow("остаются в очереди");
		expect(failedAttempts).toBe(2);
		expect((await getPendingPhotoUploads("alice", "one")).length).toBe(1);
		let sent = 0;
		await syncPhotoUploads("alice", async ({ data }) => {
			sent++;
			expect(data.get("userId")).toBe("alice");
			expect(["one", "old"]).toContain(String(data.get("snapshotId")));
			expect(await (data.get("file") as File).text()).toBe("photo");
		});
		expect(sent).toBe(2);
		expect(await getPendingPhotoUploads("alice", "one")).toEqual([]);
		expect((await getPendingPhotoUploads("bob", "one")).length).toBe(1);
		expect(await getPendingPhotoUploads("alice", "old")).toEqual([]);
	});
	it("rejects a mismatched author before database or storage access", async () => {
		const data = new FormData();
		data.set("userId", "bob");
		await expect(
			archiveInstallationPhoto(data, { id: "alice", login: "alice", role: "user", department: "tai" })
		).rejects.toThrow("другому пользователю");
	});
});
