"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
	queueInstallationOutboxChange,
	queueInstallationOutboxChanges,
	removeInstallationOutboxChanges,
	type InstallationOfflineOutboxChange,
	saveCachedInstallationBoard,
} from "@/lib/installation/offline";
import {
	getInstallationGroupStatus,
	getInstallationProgressPercent,
	type InstallationBoardData,
	type InstallationGroupView,
	type InstallationKksChangeInput,
	type InstallationKksView,
	type InstallationOfflineChange,
	type InstallationVisibleColumnId,
} from "@/lib/installation/shared";

import { useNetworkStatus } from "./useNetworkStatus";

const installationRefreshIntervalMs = 15_000;

type PendingResolution = {
	pendingChangeId: string;
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

export function useInstallationBoard(initialData: InstallationBoardData, canEdit: boolean) {
	const isOnline = useNetworkStatus();
	const [data, setData] = useState(initialData);
	const [pending, setPending] = useState(false);
	const [outboxCount, setOutboxCount] = useState(0);

	const hasSnapshot = Boolean(data.snapshot);

	const refresh = useCallback(async () => {
		const nextData = await getInstallationBoardData();
		const outboxChanges = await getInstallationOutboxChanges();
		const dataWithOfflineChanges = applyOfflineChanges(nextData, outboxChanges);

		setData(dataWithOfflineChanges);
		setOutboxCount(outboxChanges.length);
		await saveCachedInstallationBoard(nextData);
	}, []);

	useEffect(() => {
		async function hydrateFromCache() {
			const [cachedData, outboxChanges] = await Promise.all([
				getCachedInstallationBoard(),
				getInstallationOutboxChanges(),
			]);

			if (cachedData && !initialData.snapshot) {
				setData(applyOfflineChanges(cachedData, outboxChanges));
			}

			setOutboxCount(outboxChanges.length);
		}

		void hydrateFromCache();
	}, [initialData.snapshot]);

	useEffect(() => {
		if (initialData.snapshot) {
			void saveCachedInstallationBoard(initialData);
		}
	}, [initialData]);

	useEffect(() => {
		if (!isOnline) return;

		const intervalId = window.setInterval(() => void refresh(), installationRefreshIntervalMs);

		return () => window.clearInterval(intervalId);
	}, [isOnline, refresh]);

	useEffect(() => {
		if (!isOnline || !canEdit) return;

		void flushOfflineChanges();
	}, [canEdit, isOnline]);

	const snapshotId = data.snapshot?.id ?? null;

	const toggleKks = useCallback(
		async (groupId: string, item: InstallationKksView, isDone: boolean) => {
			if (!snapshotId || !canEdit) return;

			setData((current) => updateBoardItem(current, groupId, item.id, isDone));

			if (!isOnline) {
				await queueOfflineChange(snapshotId, groupId, item, isDone);
				return;
			}

			await saveOnlineChange(snapshotId, groupId, item, isDone);
		},
		[canEdit, isOnline, snapshotId]
	);

	const queueKksChanges = useCallback(
		async (changes: InstallationKksChangeInput[]) => {
			if (!snapshotId || !canEdit) return;

			const latestChanges = getLatestKksChangeInputs(changes);

			if (latestChanges.length === 0) return;

			setData((current) => updateBoardItems(current, latestChanges));
			await queueOfflineChanges(snapshotId, latestChanges);

			if (isOnline) {
				await flushOfflineChanges();
			}
		},
		[canEdit, isOnline, snapshotId]
	);

	async function queueOfflineChange(
		currentSnapshotId: string,
		groupId: string,
		item: InstallationKksView,
		isDone: boolean
	) {
		const change: InstallationOfflineChange = {
			clientMutationId: createInstallationClientMutationId(item.id),
			snapshotId: currentSnapshotId,
			groupId,
			kksItemId: item.id,
			baseDone: item.isDone,
			desiredDone: isDone,
		};

		await queueInstallationOutboxChange(change);
		setOutboxCount((current) => current + 1);
		toast.info("Изменение сохранено offline и будет синхронизировано позже.");
	}

	async function queueOfflineChanges(currentSnapshotId: string, changes: InstallationKksChangeInput[]) {
		const offlineChanges = changes.map(
			(change) =>
				({
					clientMutationId: createInstallationClientMutationId(change.item.id),
					snapshotId: currentSnapshotId,
					groupId: change.groupId,
					kksItemId: change.item.id,
					baseDone: change.item.isDone,
					desiredDone: change.isDone,
				}) satisfies InstallationOfflineChange
		);

		await queueInstallationOutboxChanges(offlineChanges);
		setOutboxCount((current) => current + offlineChanges.length);
		toast.info(`Offline-изменений добавлено: ${offlineChanges.length}.`);
	}

	async function saveOnlineChange(
		currentSnapshotId: string,
		groupId: string,
		item: InstallationKksView,
		isDone: boolean
	) {
		try {
			await saveInstallationKks({
				data: {
					snapshotId: currentSnapshotId,
					groupId,
					kksItemId: item.id,
					isDone,
					baseRevision: item.revision,
				},
			});
			await refresh();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось сохранить состояние KKS.");
			await refresh();
		}
	}

	async function flushOfflineChanges() {
		const outboxChanges = await getInstallationOutboxChanges();
		const latestChanges = getLatestOfflineChanges(outboxChanges);

		if (!snapshotId || latestChanges.length === 0) return;

		try {
			await submitInstallationOfflineChanges({
				data: {
					snapshotId,
					changes: latestChanges,
				},
			});
			await removeInstallationOutboxChanges(outboxChanges.map((change) => change.clientMutationId));
			setOutboxCount(0);
			await refresh();
			toast.info("Offline-изменения перенесены в колонку «В обработке».");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось синхронизировать offline-изменения.");
		}
	}

	const applyProcessingGroup = useCallback(
		async (groupId: string, resolutions: PendingResolution[]) => {
			setPending(true);

			try {
				await applyInstallationPendingGroup({
					data: {
						groupId,
						changes: resolutions,
					},
				});
				await refresh();
				toast.success("Группа KKS утверждена в доске.");
			} finally {
				setPending(false);
			}
		},
		[refresh]
	);

	return useMemo(
		() => ({
			data,
			hasSnapshot,
			isOnline,
			outboxCount,
			pending,
			refresh,
			toggleKks,
			queueKksChanges,
			applyProcessingGroup,
		}),
		[
			applyProcessingGroup,
			data,
			hasSnapshot,
			isOnline,
			outboxCount,
			pending,
			queueKksChanges,
			refresh,
			toggleKks,
		]
	);
}
