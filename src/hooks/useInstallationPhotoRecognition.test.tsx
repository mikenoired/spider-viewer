import { afterEach, expect, it } from "bun:test";

import { act, cleanup, renderHook } from "@testing-library/react";

import { useInstallationPhotoRecognition } from "./useInstallationPhotoRecognition";

const oldIndexedDb = Object.getOwnPropertyDescriptor(window, "indexedDB");
const oldOnline = Object.getOwnPropertyDescriptor(navigator, "onLine");
afterEach(() => {
	cleanup();
	if (oldIndexedDb) Object.defineProperty(window, "indexedDB", oldIndexedDb);
	else Reflect.deleteProperty(window, "indexedDB");
	if (oldOnline) Object.defineProperty(navigator, "onLine", oldOnline);
	else Reflect.deleteProperty(navigator, "onLine");
});

it("releases the recognition action when local photo storage fails", async () => {
	Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
	Object.defineProperty(window, "indexedDB", {
		configurable: true,
		value: {
			open() {
				throw new Error("quota");
			},
		},
	});
	const known = [
		{
			snapshotId: "snapshot",
			groupId: "group",
			groupName: "group",
			kksItemId: "item",
			kksName: "KKS",
			isDone: false,
		},
	];
	const { result } = renderHook(() => useInstallationPhotoRecognition("snapshot", known, "alice"));
	await act(async () => {
		await expect(
			result.current.recognizeFiles([new File(["photo"], "photo.jpg", { type: "image/jpeg" })])
		).rejects.toThrow("quota");
	});
	expect(result.current.activeJobId).toBeNull();
});
