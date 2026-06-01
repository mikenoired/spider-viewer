"use client";

import { CheckIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getSelectedInstallationPhotoCandidates } from "@/hooks/useInstallationPhotoRecognition";
import type { InstallationPhotoCandidate, InstallationPhotoJob } from "@/lib/installation-photo/shared";

import { PhotoPreview } from "./photo-preview";
import { RecognizedKksRow } from "./recognized-kks-row";

export function PhotoRecognitionJob({
	job,
	active,
	canEdit,
	onCandidateSelectedChange,
	onApply,
	onDelete,
}: {
	job: InstallationPhotoJob;
	active: boolean;
	canEdit: boolean;
	onCandidateSelectedChange: (candidateId: string, selected: boolean) => void;
	onApply: (candidates: InstallationPhotoCandidate[]) => Promise<void>;
	onDelete: () => void;
}) {
	const selectedCandidates = getSelectedInstallationPhotoCandidates(job);
	const canApply = canEdit && job.status === "review" && selectedCandidates.length > 0;

	return (
		<div className="grid gap-3 border-t py-3 first:border-t-0 first:pt-0 last:pb-0 md:grid-cols-[12rem_1fr]">
			<PhotoPreview image={job.image} fileName={job.fileName} />
			<div className="min-w-0">
				<JobHeader
					job={job}
					canApply={canApply}
					onApply={() => onApply(selectedCandidates)}
					onDelete={onDelete}
				/>
				<JobBody
					job={job}
					active={active}
					canEdit={canEdit}
					onCandidateSelectedChange={onCandidateSelectedChange}
				/>
			</div>
		</div>
	);
}

function JobHeader({
	job,
	canApply,
	onApply,
	onDelete,
}: {
	job: InstallationPhotoJob;
	canApply: boolean;
	onApply: () => Promise<void>;
	onDelete: () => void;
}) {
	return (
		<div className="flex items-start justify-between gap-3">
			<div className="min-w-0">
				<div className="truncate text-sm font-medium">{job.fileName}</div>
				<div className="text-xs text-muted-foreground">{getJobStatusLabel(job)}</div>
			</div>
			<div className="flex shrink-0 items-center gap-1">
				<Button type="button" size="sm" disabled={!canApply} onClick={() => void onApply()}>
					<CheckIcon data-icon="inline-start" />
					Отметить
				</Button>
				<Button type="button" variant="ghost" size="icon-sm" onClick={onDelete} aria-label="Удалить фото">
					<Trash2Icon />
				</Button>
			</div>
		</div>
	);
}

function JobBody({
	job,
	active,
	canEdit,
	onCandidateSelectedChange,
}: {
	job: InstallationPhotoJob;
	active: boolean;
	canEdit: boolean;
	onCandidateSelectedChange: (candidateId: string, selected: boolean) => void;
}) {
	if (job.status === "recognizing" || active) {
		return (
			<div className="mt-3 flex flex-col gap-2">
				<Progress value={job.progress} />
				<div className="text-xs text-muted-foreground">Распознавание: {job.progress}%</div>
			</div>
		);
	}

	if (job.status === "failed") {
		return <div className="mt-3 text-sm text-destructive">{job.errorMessage}</div>;
	}

	if (job.candidates.length === 0) {
		return <div className="mt-3 text-sm text-muted-foreground">Совпадений KKS не найдено.</div>;
	}

	return (
		<ScrollArea className="mt-3 max-h-64 rounded-lg border">
			{job.candidates.map((candidate) => (
				<RecognizedKksRow
					key={candidate.id}
					candidate={candidate}
					disabled={!canEdit || job.status === "applied"}
					onSelectedChange={(selected) => onCandidateSelectedChange(candidate.id, selected)}
				/>
			))}
		</ScrollArea>
	);
}

function getJobStatusLabel(job: InstallationPhotoJob) {
	if (job.status === "recognizing") return "Распознается";
	if (job.status === "review") return `Найдено: ${job.candidates.length}`;
	if (job.status === "applied") return "Добавлено в офлайн-очередь";

	return "Ошибка распознавания";
}
