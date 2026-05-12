import type {
	InstallationBoardData,
	InstallationGroupView,
	InstallationKksView,
} from "@/lib/installation/shared";

export const installationPhotoJobStatuses = ["recognizing", "review", "applied", "failed"] as const;

export type InstallationPhotoJobStatus = (typeof installationPhotoJobStatuses)[number];

export type InstallationPhotoKnownItem = {
	snapshotId: string;
	groupId: string;
	groupName: string;
	kksItemId: string;
	kksName: string;
	isDone: boolean;
};

export type InstallationPhotoBoundingBox = {
	left: number;
	top: number;
	width: number;
	height: number;
};

export type InstallationPhotoCandidate = {
	id: string;
	groupId: string;
	groupName: string;
	kksItemId: string;
	kksName: string;
	rawText: string;
	normalizedText: string;
	confidence: number;
	markerScore: number;
	boundingBox: InstallationPhotoBoundingBox | null;
	selected: boolean;
};

export type InstallationPhotoJob = {
	id: string;
	snapshotId: string;
	fileName: string;
	image: Blob;
	status: InstallationPhotoJobStatus;
	progress: number;
	candidates: InstallationPhotoCandidate[];
	ocrText: string;
	errorMessage: string | null;
	createdAt: string;
	updatedAt: string;
	appliedAt: string | null;
};

function collectGroups(data: InstallationBoardData) {
	return [...data.columns.not_started, ...data.columns.in_progress, ...data.columns.done];
}

function createKnownItemsFromGroup(
	snapshotId: string,
	group: InstallationGroupView,
	item: InstallationKksView
) {
	return {
		snapshotId,
		groupId: group.id,
		groupName: group.name,
		kksItemId: item.id,
		kksName: item.name,
		isDone: item.isDone,
	} satisfies InstallationPhotoKnownItem;
}

export function getInstallationPhotoKnownItems(data: InstallationBoardData) {
	const snapshotId = data.snapshot?.id;

	if (!snapshotId) return [];

	return collectGroups(data).flatMap((group) =>
		group.kksItems.map((item) => createKnownItemsFromGroup(snapshotId, group, item))
	);
}
