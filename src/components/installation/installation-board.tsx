"use client";

import { useState } from "react";
import { toast } from "sonner";

import { InstallationPhotoOcrSetup } from "@/components/installation-photo/installation-photo-ocr-setup";
import { InstallationPhotoPanel } from "@/components/installation-photo/installation-photo-panel";
import { Card, CardContent } from "@/components/ui/card";
import { useInstallationBoard } from "@/hooks/useInstallationBoard";
import { useInstallationPhotoOcrAssets } from "@/hooks/useInstallationPhotoOcrAssets";
import {
	getInstallationPhotoKnownItems,
	type InstallationPhotoCandidate,
} from "@/lib/installation-photo/shared";
import { type InstallationBoardData, type InstallationKksChangeInput } from "@/lib/installation/shared";

import { InstallationColumn } from "./installation-column";
import { InstallationStatusBar } from "./installation-status-bar";
import { KksGroupSheet } from "./kks-group-sheet";
import { ProcessingColumn } from "./processing-column";
import { ProcessingGroupSheet } from "./processing-group-sheet";

function getBoardGroups(data: InstallationBoardData) {
	return [...data.columns.not_started, ...data.columns.in_progress, ...data.columns.done];
}

function findGroupById(data: InstallationBoardData, groupId: string | null) {
	if (!groupId) return null;

	return getBoardGroups(data).find((group) => group.id === groupId) ?? null;
}

function findProcessingGroupById(data: InstallationBoardData, groupId: string | null) {
	if (!groupId) return null;

	return data.processingGroups.find((group) => group.id === groupId) ?? null;
}

function createKksItemLookup(data: InstallationBoardData) {
	const entries = getBoardGroups(data).flatMap((group) =>
		group.kksItems.map((item) => [`${group.id}:${item.id}`, { groupId: group.id, item }] as const)
	);

	return new Map(entries);
}

function createPhotoChangeInputs(data: InstallationBoardData, candidates: InstallationPhotoCandidate[]) {
	const itemByKey = createKksItemLookup(data);

	return candidates.flatMap((candidate) => {
		const row = itemByKey.get(`${candidate.groupId}:${candidate.kksItemId}`);

		if (!row || row.item.isDone) return [];

		return [
			{
				groupId: row.groupId,
				item: row.item,
				isDone: true,
			} satisfies InstallationKksChangeInput,
		];
	});
}

export function InstallationBoard({
	initialData,
	canEdit,
}: {
	initialData: InstallationBoardData;
	canEdit: boolean;
}) {
	const board = useInstallationBoard(initialData, canEdit);
	const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
	const [processingGroupId, setProcessingGroupId] = useState<string | null>(null);
	const selectedGroup = findGroupById(board.data, selectedGroupId);
	const processingGroup = findProcessingGroupById(board.data, processingGroupId);
	const photoKnownItems = getInstallationPhotoKnownItems(board.data);
	const photoOcrAssets = useInstallationPhotoOcrAssets(canEdit && board.hasSnapshot);

	async function handleRefresh() {
		try {
			await board.refresh();
			toast.success("Данные монтажа обновлены.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось обновить монтаж.");
		}
	}

	async function handleApplyPhotoCandidates(candidates: InstallationPhotoCandidate[]) {
		const changes = createPhotoChangeInputs(board.data, candidates);

		if (changes.length === 0) {
			toast.info("Новых KKS для отметки нет.");
			return;
		}

		await board.queueKksChanges(changes);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4">
			<InstallationStatusBar
				isOnline={board.isOnline}
				outboxCount={board.outboxCount}
				onRefresh={() => void handleRefresh()}
			/>
			{board.hasSnapshot && photoOcrAssets.shouldShowSetup ? (
				<InstallationPhotoOcrSetup
					assetState={photoOcrAssets.assetState}
					assetProgress={photoOcrAssets.assetProgress}
					preparingAssets={photoOcrAssets.preparingAssets}
					onPrepareAssets={photoOcrAssets.prepareAssets}
					onDismiss={photoOcrAssets.dismissSetup}
				/>
			) : board.hasSnapshot ? (
				<>
					<InstallationPhotoPanel
						snapshotId={board.data.snapshot?.id ?? null}
						knownItems={photoKnownItems}
						canEdit={canEdit}
						assetState={photoOcrAssets.assetState}
						assetProgress={photoOcrAssets.assetProgress}
						preparingAssets={photoOcrAssets.preparingAssets}
						ocrReady={photoOcrAssets.isReady}
						onPrepareAssets={photoOcrAssets.prepareAssets}
						onApplyCandidates={handleApplyPhotoCandidates}
					/>
					<ProcessingColumn
						groups={board.data.processingGroups}
						onOpen={(group) => setProcessingGroupId(group.id)}
					/>
					<div className="flex min-h-[calc(100svh-var(--app-shell-header-height)-var(--app-shell-content-padding)-5rem)] flex-1 overflow-x-auto pb-2">
						<div className="flex min-h-full w-max gap-3">
							<InstallationColumn
								columnId="not_started"
								groups={board.data.columns.not_started}
								onGroupOpen={(group) => setSelectedGroupId(group.id)}
							/>
							<InstallationColumn
								columnId="in_progress"
								groups={board.data.columns.in_progress}
								onGroupOpen={(group) => setSelectedGroupId(group.id)}
							/>
							<InstallationColumn
								columnId="done"
								groups={board.data.columns.done}
								onGroupOpen={(group) => setSelectedGroupId(group.id)}
							/>
						</div>
					</div>
				</>
			) : (
				<InstallationEmptyState />
			)}
			<KksGroupSheet
				group={selectedGroup}
				canEdit={canEdit}
				open={Boolean(selectedGroupId)}
				onOpenChange={(open) => setSelectedGroupId(open ? selectedGroupId : null)}
				onToggle={board.toggleKks}
			/>
			<ProcessingGroupSheet
				group={processingGroup}
				open={Boolean(processingGroupId)}
				pending={board.pending}
				onOpenChange={(open) => setProcessingGroupId(open ? processingGroupId : null)}
				onApply={(resolutions) => {
					if (!processingGroup) return Promise.resolve();

					return board.applyProcessingGroup(processingGroup.id, resolutions);
				}}
			/>
		</div>
	);
}

function InstallationEmptyState() {
	return (
		<Card>
			<CardContent className="px-4 py-10 text-sm text-muted-foreground">
				Данные монтажа пока не загружены. Импорт находится на странице «Загрузка данных».
			</CardContent>
		</Card>
	);
}
