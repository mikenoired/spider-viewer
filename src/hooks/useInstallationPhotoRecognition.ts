"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { recognizeInstallationPhoto } from "@/lib/installation-photo/ocr";
import {
	getInstallationPhotoJobs,
	removeInstallationPhotoJob,
	saveInstallationPhotoJob,
} from "@/lib/installation-photo/offline";
import type {
	InstallationPhotoCandidate,
	InstallationPhotoJob,
	InstallationPhotoKnownItem,
} from "@/lib/installation-photo/shared";

function createPhotoJob(snapshotId: string, file: File) {
	const now = new Date().toISOString();

	return {
		id: crypto.randomUUID(),
		snapshotId,
		fileName: file.name || "photo.jpg",
		image: file,
		status: "recognizing",
		progress: 0,
		candidates: [],
		ocrText: "",
		errorMessage: null,
		createdAt: now,
		updatedAt: now,
		appliedAt: null,
	} satisfies InstallationPhotoJob;
}

function createUpdatedJob(
	job: InstallationPhotoJob,
	updates: Partial<
		Pick<InstallationPhotoJob, "status" | "progress" | "candidates" | "ocrText" | "errorMessage">
	>
) {
	return {
		...job,
		...updates,
		updatedAt: new Date().toISOString(),
	} satisfies InstallationPhotoJob;
}

function setJobInList(jobs: InstallationPhotoJob[], job: InstallationPhotoJob) {
	const exists = jobs.some((currentJob) => currentJob.id === job.id);

	if (!exists) return [job, ...jobs];

	return jobs.map((currentJob) => (currentJob.id === job.id ? job : currentJob));
}

export function useInstallationPhotoRecognition(
	snapshotId: string | null,
	knownItems: InstallationPhotoKnownItem[]
) {
	const [jobs, setJobs] = useState<InstallationPhotoJob[]>([]);
	const [activeJobId, setActiveJobId] = useState<string | null>(null);
	const knownItemCount = knownItems.length;

	useEffect(() => {
		if (!snapshotId) {
			setJobs([]);
			return;
		}

		void hydrateJobs(snapshotId);
	}, [snapshotId]);

	async function hydrateJobs(currentSnapshotId: string) {
		try {
			setJobs(await getInstallationPhotoJobs(currentSnapshotId));
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось открыть фото-кэш.");
		}
	}

	const recognizeFiles = useCallback(
		async (files: File[]) => {
			if (!snapshotId || knownItemCount === 0) return;

			for (const file of files) {
				await recognizeFile(snapshotId, file, knownItems);
			}
		},
		[knownItemCount, knownItems, snapshotId]
	);

	async function recognizeFile(
		currentSnapshotId: string,
		file: File,
		currentKnownItems: InstallationPhotoKnownItem[]
	) {
		const job = createPhotoJob(currentSnapshotId, file);

		setActiveJobId(job.id);
		await upsertJob(job);

		try {
			const result = await recognizeInstallationPhoto(file, currentKnownItems, (progress) =>
				updateJobProgress(job, progress)
			);
			await upsertJob(
				createUpdatedJob(job, {
					status: "review",
					progress: 100,
					candidates: result.candidates,
					ocrText: result.ocrText,
				})
			);
		} catch (error) {
			await upsertJob(createFailedJob(job, error));
		} finally {
			setActiveJobId(null);
		}
	}

	function updateJobProgress(job: InstallationPhotoJob, progress: number) {
		setJobs((currentJobs) => setJobInList(currentJobs, createUpdatedJob(job, { progress })));
	}

	function createFailedJob(job: InstallationPhotoJob, error: unknown) {
		return createUpdatedJob(job, {
			status: "failed",
			progress: 0,
			errorMessage: error instanceof Error ? error.message : "Фото не удалось распознать.",
		});
	}

	async function upsertJob(job: InstallationPhotoJob) {
		setJobs((currentJobs) => setJobInList(currentJobs, job));
		await saveInstallationPhotoJob(job);
	}

	const updateCandidateSelection = useCallback(
		async (jobId: string, candidateId: string, selected: boolean) => {
			const job = jobs.find((currentJob) => currentJob.id === jobId);

			if (!job) return;

			const candidates = job.candidates.map((candidate) =>
				candidate.id === candidateId ? { ...candidate, selected } : candidate
			);
			await upsertJob(createUpdatedJob(job, { candidates }));
		},
		[jobs]
	);

	const markJobApplied = useCallback(
		async (jobId: string) => {
			const job = jobs.find((currentJob) => currentJob.id === jobId);

			if (!job) return;

			await upsertJob({
				...job,
				status: "applied",
				appliedAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			});
		},
		[jobs]
	);

	const deleteJob = useCallback(async (jobId: string) => {
		await removeInstallationPhotoJob(jobId);
		setJobs((currentJobs) => currentJobs.filter((job) => job.id !== jobId));
	}, []);

	return useMemo(
		() => ({
			jobs,
			activeJobId,
			recognizeFiles,
			updateCandidateSelection,
			markJobApplied,
			deleteJob,
		}),
		[activeJobId, deleteJob, jobs, markJobApplied, recognizeFiles, updateCandidateSelection]
	);
}

export function getSelectedInstallationPhotoCandidates(job: InstallationPhotoJob) {
	return job.candidates.filter((candidate): candidate is InstallationPhotoCandidate => candidate.selected);
}
