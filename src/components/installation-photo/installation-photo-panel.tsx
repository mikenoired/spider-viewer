"use client";

import { CameraIcon, DownloadIcon, ImagesIcon } from "lucide-react";
import { useRef, useState, type RefObject } from "react";

import { InstallationCameraDialog } from "@/components/installation-photo/installation-camera-dialog";
import { PhotoRecognitionJob } from "@/components/installation-photo/photo-recognition-job";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useInstallationPhotoRecognition } from "@/hooks/useInstallationPhotoRecognition";
import type {
	InstallationPhotoAssetProgress,
	InstallationPhotoAssetState,
} from "@/lib/installation-photo/assets";
import type { InstallationPhotoCandidate, InstallationPhotoKnownItem } from "@/lib/installation-photo/shared";

export function InstallationPhotoPanel({
	snapshotId,
	knownItems,
	canEdit,
	assetState,
	assetProgress,
	preparingAssets,
	ocrReady,
	onPrepareAssets,
	onApplyCandidates,
}: {
	snapshotId: string | null;
	knownItems: InstallationPhotoKnownItem[];
	canEdit: boolean;
	assetState: InstallationPhotoAssetState;
	assetProgress: InstallationPhotoAssetProgress | null;
	preparingAssets: boolean;
	ocrReady: boolean;
	onPrepareAssets: () => Promise<void>;
	onApplyCandidates: (candidates: InstallationPhotoCandidate[]) => Promise<void>;
}) {
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [cameraOpen, setCameraOpen] = useState(false);
	const photoRecognition = useInstallationPhotoRecognition(snapshotId, knownItems);
	const canRecognize =
		canEdit && ocrReady && Boolean(snapshotId) && knownItems.length > 0 && !photoRecognition.activeJobId;

	async function handleInputFilesChange(files: FileList | null) {
		await handleFiles(Array.from(files ?? []));
		resetFileInput(fileInputRef);
	}

	async function handleApplyJob(jobId: string, candidates: InstallationPhotoCandidate[]) {
		await onApplyCandidates(candidates);
		await photoRecognition.markJobApplied(jobId);
	}

	if (!snapshotId) return null;

	return (
		<Card size="sm">
			<PhotoPanelHeader
				kksCount={knownItems.length}
				assetState={assetState}
				preparingAssets={preparingAssets}
				onPrepareAssets={onPrepareAssets}
			/>
			<CardContent className="flex flex-col gap-4">
				<PhotoReadinessNotice assetState={assetState} />
				<PhotoFileInput
					inputRef={fileInputRef}
					canRecognize={canRecognize}
					onFilesChange={handleInputFilesChange}
				/>
				<PhotoPanelActions
					canRecognize={canRecognize}
					onOpenCamera={() => setCameraOpen(true)}
					onOpenPicker={() => fileInputRef.current?.click()}
				/>
				{preparingAssets && assetProgress ? <Progress value={assetProgress.percent} /> : null}
				<PhotoJobsList
					jobs={photoRecognition.jobs}
					activeJobId={photoRecognition.activeJobId}
					canEdit={canEdit}
					onCandidateSelectedChange={photoRecognition.updateCandidateSelection}
					onApply={handleApplyJob}
					onDelete={photoRecognition.deleteJob}
				/>
				<InstallationCameraDialog open={cameraOpen} onOpenChange={setCameraOpen} onCapture={handleFiles} />
			</CardContent>
		</Card>
	);

	async function handleFiles(files: File[]) {
		if (files.length === 0 || !canRecognize) return;

		await photoRecognition.recognizeFiles(files);
	}
}

function PhotoPanelHeader({
	kksCount,
	assetState,
	preparingAssets,
	onPrepareAssets,
}: {
	kksCount: number;
	assetState: InstallationPhotoAssetState;
	preparingAssets: boolean;
	onPrepareAssets: () => Promise<void>;
}) {
	const isReady = assetState.status === "ready";

	return (
		<CardHeader>
			<CardTitle>Фото монтажа</CardTitle>
			<CardDescription>{kksCount} KKS в активном snapshot</CardDescription>
			<CardAction>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={preparingAssets || isReady || assetState.status === "unsupported"}
					onClick={() => void onPrepareAssets()}>
					<DownloadIcon data-icon="inline-start" />
					{isReady ? "OCR готов" : "Подготовить OCR"}
				</Button>
			</CardAction>
		</CardHeader>
	);
}

function PhotoFileInput({
	inputRef,
	canRecognize,
	onFilesChange,
}: {
	inputRef: RefObject<HTMLInputElement | null>;
	canRecognize: boolean;
	onFilesChange: (files: FileList | null) => Promise<void>;
}) {
	return (
		<FieldGroup>
			<Field>
				<FieldLabel htmlFor="installation-photo-input" className="sr-only">
					Фото
				</FieldLabel>
				<Input
					ref={inputRef}
					id="installation-photo-input"
					type="file"
					className="sr-only"
					accept="image/*"
					multiple
					disabled={!canRecognize}
					onChange={(event) => void onFilesChange(event.currentTarget.files)}
				/>
			</Field>
		</FieldGroup>
	);
}

function PhotoPanelActions({
	canRecognize,
	onOpenCamera,
	onOpenPicker,
}: {
	canRecognize: boolean;
	onOpenCamera: () => void;
	onOpenPicker: () => void;
}) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			<Button type="button" disabled={!canRecognize} onClick={onOpenCamera}>
				<CameraIcon data-icon="inline-start" />
				Сделать фото
			</Button>
			<Button type="button" variant="outline" disabled={!canRecognize} onClick={onOpenPicker}>
				<ImagesIcon data-icon="inline-start" />
				Выбрать
			</Button>
		</div>
	);
}

function PhotoReadinessNotice({ assetState }: { assetState: InstallationPhotoAssetState }) {
	if (assetState.status === "ready") return null;
	if (assetState.status === "checking") {
		return <div className="text-sm text-muted-foreground">Проверяем OCR-модель на устройстве.</div>;
	}

	return (
		<div className="rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">
			OCR-модель не скачана. Фото можно включить здесь: «Фото монтажа» / «Подготовить OCR».
		</div>
	);
}

function resetFileInput(inputRef: RefObject<HTMLInputElement | null>) {
	if (!inputRef.current) return;

	inputRef.current.value = "";
}

function PhotoJobsList({
	jobs,
	activeJobId,
	canEdit,
	onCandidateSelectedChange,
	onApply,
	onDelete,
}: {
	jobs: ReturnType<typeof useInstallationPhotoRecognition>["jobs"];
	activeJobId: string | null;
	canEdit: boolean;
	onCandidateSelectedChange: (jobId: string, candidateId: string, selected: boolean) => Promise<void>;
	onApply: (jobId: string, candidates: InstallationPhotoCandidate[]) => Promise<void>;
	onDelete: (jobId: string) => Promise<void>;
}) {
	if (jobs.length === 0) return <PhotoPanelEmptyState />;

	return (
		<div className="flex flex-col">
			{jobs.map((job) => (
				<PhotoRecognitionJob
					key={job.id}
					job={job}
					active={activeJobId === job.id}
					canEdit={canEdit}
					onCandidateSelectedChange={(candidateId, selected) =>
						void onCandidateSelectedChange(job.id, candidateId, selected)
					}
					onApply={(candidates) => onApply(job.id, candidates)}
					onDelete={() => void onDelete(job.id)}
				/>
			))}
		</div>
	);
}

function PhotoPanelEmptyState() {
	return <div className="text-sm text-muted-foreground">Фото для проверки пока нет.</div>;
}
