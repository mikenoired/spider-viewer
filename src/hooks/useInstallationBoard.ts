"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
	applyInstallationPendingGroup,
	getInstallationBoardData,
	saveInstallationKks,
	submitInstallationOfflineChanges,
} from "@/lib/installation/functions";
import {
	createInstallationClientMutationId,
	getCachedInstallationBoard,
	getInstallationOutboxChanges,
	type InstallationOfflineOutboxChange,
	queueInstallationOutboxChanges,
	removeInstallationOutboxChanges,
	saveCachedInstallationBoard,
} from "@/lib/installation/offline";
import {
	getInstallationGroupStatus,
	getInstallationProgressPercent,
	type InstallationBoardData,
	type InstallationGroupView,
	type InstallationKksChangeInput,
	type InstallationKksView,
	type InstallationVisibleColumnId,
} from "@/lib/installation/shared";

import { useNetworkStatus } from "./useNetworkStatus";

const installationRefreshIntervalMs = 15_000;

type PendingResolution = {
	pendingChangeId: string;
	baseRevision: number;
	resolvedDone: boolean;
};

function createEmptyColumns(): Record<InstallationVisibleColumnId, InstallationGroupView[]> {
	return {
		not_started: [],
		in_progress: [],
		done: [],
	};
}

function collectGroups(data: InstallationBoardData) {
	return [...data.columns.not_started, ...data.columns.in_progress, ...data.columns.done];
}

function createGroupWithUpdatedItem(group: InstallationGroupView, kksItemId: string, isDone: boolean) {
	const kksItems = group.kksItems.map((item) => (item.id === kksItemId ? { ...item, isDone } : item));
	const doneCount = kksItems.filter((item) => item.isDone).length;

	return {
		...group,
		status: getInstallationGroupStatus(doneCount, group.totalCount),
		doneCount,
		progressPercent: getInstallationProgressPercent(doneCount, group.totalCount),
		kksItems,
	} satisfies InstallationGroupView;
}

function buildColumns(groups: InstallationGroupView[]) {
	const columns = createEmptyColumns();

	for (const group of groups) {
		columns[group.status].push(group);
	}

	return columns;
}

function updateBoardItem(data: InstallationBoardData, groupId: string, kksItemId: string, isDone: boolean) {
	const groups = collectGroups(data).map((group) =>
		group.id === groupId ? createGroupWithUpdatedItem(group, kksItemId, isDone) : group
	);

	return {
		...data,
		columns: buildColumns(groups),
	};
}

function updateBoardItems(data: InstallationBoardData, changes: InstallationKksChangeInput[]) {
	return changes.reduce(
		(currentData, change) => updateBoardItem(currentData, change.groupId, change.item.id, change.isDone),
		data
	);
}

function getLatestKksChangeInputs(changes: InstallationKksChangeInput[]) {
	const latestByItemId = new Map<string, InstallationKksChangeInput>();

	for (const change of changes) {
		latestByItemId.set(change.item.id, change);
	}

	return [...latestByItemId.values()];
}

function getLatestOfflineChanges(changes: InstallationOfflineOutboxChange[]) {
	const latestByItemId = new Map<string, InstallationOfflineOutboxChange>();
	const baseDoneByItemId = new Map<string, boolean>();

	for (const change of changes) {
		baseDoneByItemId.set(change.kksItemId, baseDoneByItemId.get(change.kksItemId) ?? change.baseDone);
		latestByItemId.set(change.kksItemId, change);
	}

	return [...latestByItemId.values()].map((change) => ({
		...change,
		baseDone: baseDoneByItemId.get(change.kksItemId) ?? change.baseDone,
	}));
}

function applyOfflineChanges(data: InstallationBoardData, changes: InstallationOfflineOutboxChange[]) {
	return getLatestOfflineChanges(changes).reduce(
		(currentData, change) =>
			updateBoardItem(currentData, change.groupId, change.kksItemId, change.desiredDone),
		data
	);
}

export function isInstallationNetworkError(error: unknown) {
	return (
		error instanceof Error &&
		(error.name === "NetworkError" ||
			(error instanceof TypeError && /fetch|network|load failed/i.test(error.message)))
	);
}

export function useInstallationBoard(initialData: InstallationBoardData, canEdit: boolean, userId: string) {
	const isOnline = useNetworkStatus();
	const [data, setData] = useState(initialData);
	const [pending, setPending] = useState(false);
	const [outboxCount, setOutboxCount] = useState(0);
	const [staleOutboxCount, setStaleOutboxCount] = useState(0);
	const flushing = useRef(false);
	const refreshGeneration = useRef(0);
	const snapshotId = data.snapshot?.id ?? null;

	const refresh = useCallback(async () => {
		const generation = ++refreshGeneration.current;
		const nextData = await getInstallationBoardData();
		const allChanges = await getInstallationOutboxChanges(userId);
		const currentChanges = allChanges.filter((change) => change.snapshotId === nextData.snapshot?.id);
		if (generation !== refreshGeneration.current) return;
		setData(applyOfflineChanges(nextData, currentChanges));
		setOutboxCount(currentChanges.length);
		setStaleOutboxCount(allChanges.length - currentChanges.length);
		await saveCachedInstallationBoard(nextData, userId);
	}, [userId]);

	useEffect(() => {
		let active = true;
		void (async () => {
			try {
				const [cached, changes] = await Promise.all([
					getCachedInstallationBoard(userId),
					getInstallationOutboxChanges(userId),
				]);
				if (!active) return;
				const board = initialData.snapshot ? initialData : (cached ?? initialData);
				const current = changes.filter((change) => change.snapshotId === board.snapshot?.id);
				setData(applyOfflineChanges(board, current));
				setOutboxCount(current.length);
				setStaleOutboxCount(changes.length - current.length);
				if (initialData.snapshot) await saveCachedInstallationBoard(initialData, userId);
			} catch (error) {
				toast.error(error instanceof Error ? error.message : "Не удалось открыть офлайн-хранилище.");
			}
		})();
		return () => {
			active = false;
		};
	}, [initialData, userId]);

	const flushOfflineChanges = useCallback(async () => {
		if (!canEdit || !snapshotId || flushing.current) return;
		flushing.current = true;
		try {
			const outbox = await getInstallationOutboxChanges(userId, snapshotId);
			if (!outbox.length) return;
			await submitInstallationOfflineChanges({
				data: { userId, snapshotId, changes: getLatestOfflineChanges(outbox) },
			});
			await removeInstallationOutboxChanges(outbox.map((change) => change.clientMutationId));
			await refresh();
			toast.info("Офлайн-изменения перенесены в колонку «В обработке».");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось синхронизировать офлайн-изменения.");
		} finally {
			flushing.current = false;
		}
	}, [canEdit, snapshotId, userId, refresh]);

	useEffect(() => {
		if (isOnline && navigator.onLine !== false) void flushOfflineChanges();
	}, [isOnline, flushOfflineChanges]);

	useEffect(() => {
		if (!isOnline) return;
		const timer = window.setInterval(() => {
			if (document.visibilityState === "hidden") return;
			void flushOfflineChanges()
				.then(refresh)
				.catch(() => undefined);
		}, installationRefreshIntervalMs);
		return () => window.clearInterval(timer);
	}, [isOnline, refresh, flushOfflineChanges]);

	const persistChanges = useCallback(
		async (changes: InstallationKksChangeInput[]) => {
			if (!snapshotId) return;
			await queueInstallationOutboxChanges(
				changes.map((change) => ({
					clientMutationId: createInstallationClientMutationId(change.item.id),
					snapshotId,
					groupId: change.groupId,
					kksItemId: change.item.id,
					baseDone: change.item.isDone,
					desiredDone: change.isDone,
				})),
				userId
			);
			setOutboxCount((count) => count + changes.length);
			toast.info("Изменения сохранены локально и будут синхронизированы позже.");
		},
		[snapshotId, userId]
	);

	const toggleKks = useCallback(
		async (groupId: string, item: InstallationKksView, isDone: boolean) => {
			if (!snapshotId || !canEdit) return;
			setData((current) => updateBoardItem(current, groupId, item.id, isDone));
			if (!isOnline) {
				await persistChanges([{ groupId, item, isDone }]);
				return;
			}
			try {
				await saveInstallationKks({
					data: { snapshotId, groupId, kksItemId: item.id, isDone, baseRevision: item.revision },
				});
			} catch (error) {
				if (isInstallationNetworkError(error)) {
					await persistChanges([{ groupId, item, isDone }]);
					return;
				}
				toast.error(error instanceof Error ? error.message : "Не удалось сохранить состояние KKS.");
			}
			// A failure to refresh after a successful write must not enqueue that write again.
			await refresh().catch(() => undefined);
		},
		[snapshotId, canEdit, isOnline, persistChanges, refresh]
	);

	const queueKksChanges = useCallback(
		async (changes: InstallationKksChangeInput[]) => {
			if (!snapshotId || !canEdit) return;
			const latest = getLatestKksChangeInputs(changes);
			if (!latest.length) return;
			await persistChanges(latest);
			setData((current) => updateBoardItems(current, latest));
			if (isOnline) await flushOfflineChanges();
		},
		[snapshotId, canEdit, persistChanges, isOnline, flushOfflineChanges]
	);

	const applyProcessingGroup = useCallback(
		async (groupId: string, resolutions: PendingResolution[]) => {
			setPending(true);
			try {
				await applyInstallationPendingGroup({ data: { groupId, changes: resolutions } });
				await refresh();
				toast.success("Группа KKS утверждена в доске.");
			} catch (error) {
				await refresh().catch(() => undefined);
				throw error;
			} finally {
				setPending(false);
			}
		},
		[refresh]
	);

	return {
		data,
		hasSnapshot: Boolean(data.snapshot),
		isOnline,
		outboxCount,
		staleOutboxCount,
		pending,
		refresh,
		toggleKks,
		queueKksChanges,
		applyProcessingGroup,
	};
}
