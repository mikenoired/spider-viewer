import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";

import { getInstallationOutboxChanges, queueInstallationOutboxChange } from "@/lib/installation/offline";
import type { InstallationBoardData } from "@/lib/installation/shared";

const save = mock(async (_input: unknown) => ({}));
const submit = mock(async (_input: unknown) => ({}));
const item = {
	id: "item",
	name: "KKS",
	isDone: false,
	revision: 1,
	itemType: "cable" as const,
	sourceSheet: "",
	sourceRowIndex: 0,
	sourceColumnLabel: "",
	matchedInCableBase: false,
	updatedAt: "",
};
const board: InstallationBoardData = {
	snapshot: {
		id: "active",
		fileName: "test",
		fileType: "xlsx",
		rowCount: 1,
		groupCount: 1,
		kksCount: 1,
		cableCount: 1,
		mechanismCount: 0,
		baseMatchedCount: 0,
		baseDoneCount: 0,
		createdAt: "",
	},
	columns: {
		not_started: [
			{
				id: "group",
				name: "group",
				status: "not_started",
				doneCount: 0,
				totalCount: 1,
				progressPercent: 0,
				kksItems: [item],
			},
		],
		in_progress: [],
		done: [],
	},
	processingGroups: [],
};
const read = mock(async () => board);
mock.module("@/lib/installation/functions", () => ({
	saveInstallationKks: save,
	submitInstallationOfflineChanges: submit,
	getInstallationBoardData: read,
	applyInstallationPendingGroup: mock(async () => ({})),
}));
const { useInstallationBoard } = await import("./useInstallationBoard");

beforeEach(() => {
	Object.defineProperty(window, "indexedDB", { configurable: true, value: new IDBFactory() });
	Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
	save.mockReset();
	submit.mockReset();
	read.mockReset();
	save.mockResolvedValue({});
	submit.mockResolvedValue({});
	read.mockResolvedValue(board);
});
afterEach(cleanup);

describe("installation board recovery", () => {
	it("retains a failed online write when the network disappears before navigator.onLine changes", async () => {
		save.mockRejectedValueOnce(new TypeError("Failed to fetch"));
		const { result } = renderHook(() => useInstallationBoard(board, true, "alice"));
		await act(async () => {
			await result.current.toggleKks("group", item, true);
			expect(await getInstallationOutboxChanges("alice", "active")).toHaveLength(1);
		});
	});
	it("does not queue authorization/validation failures for automatic retry", async () => {
		save.mockRejectedValueOnce(new Error("Недостаточно прав"));
		const { result } = renderHook(() => useInstallationBoard(board, true, "alice"));
		await act(async () => {
			await result.current.toggleKks("group", item, true);
			expect(await getInstallationOutboxChanges("alice")).toHaveLength(0);
		});
	});
	it("synchronizes only the current user's active snapshot", async () => {
		const change = {
			clientMutationId: "current",
			snapshotId: "active",
			groupId: "group",
			kksItemId: "item",
			baseDone: false,
			desiredDone: true,
		};
		await queueInstallationOutboxChange({ ...change, clientMutationId: "old", snapshotId: "old" }, "alice");
		await queueInstallationOutboxChange({ ...change, clientMutationId: "bob" }, "bob");
		await queueInstallationOutboxChange(change, "alice");
		renderHook(() => useInstallationBoard(board, true, "alice"));
		await act(async () => {
			await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
			expect(submit.mock.calls[0]?.[0]).toMatchObject({
				data: { snapshotId: "active", changes: [{ clientMutationId: "current" }] },
			});
			await waitFor(async () =>
				expect(await getInstallationOutboxChanges("alice", "active")).toHaveLength(0)
			);
			expect(await getInstallationOutboxChanges("alice", "old")).toHaveLength(1);
			expect(await getInstallationOutboxChanges("bob")).toHaveLength(1);
		});
	});
	it("does not enqueue an already committed change when only refresh fails", async () => {
		read.mockRejectedValueOnce(new TypeError("Failed to fetch"));
		const { result } = renderHook(() => useInstallationBoard(board, true, "alice"));
		await act(async () => {
			await result.current.toggleKks("group", item, true);
			expect(await getInstallationOutboxChanges("alice")).toHaveLength(0);
		});
	});
});
