import type {
	DashboardData,
	GraphBucketView,
	GraphGroupView,
} from "@/lib/cable-map/shared";
import {
	bandBorderThickness,
	getPdfImportedRoomBlockHeight,
	getPdfManualRoomBlockHeight,
	getZonePriority,
	minPdfRowHeight,
	pdfRowVerticalInset,
	shaftCapInset,
} from "./config";
import type { GraphSide, LevelBand } from "./types";

export function buildLevelBands(levels: DashboardData["levels"]): LevelBand[] {
	let globalRowIndex = 0;

	const rawBands = levels.map((level) => {
		const dirtyGroups = sortGroupsForPdf(level.dirtyGroups);
		const cleanGroups = sortGroupsForPdf(level.cleanGroups);
		const rowCount = Math.max(dirtyGroups.length, cleanGroups.length, 1);
		const rows = Array.from({ length: rowCount }, (_, rowIndex) => ({
			dirtyGroup: dirtyGroups[rowIndex] ?? null,
			cleanGroup: cleanGroups[rowIndex] ?? null,
			globalRowIndex: globalRowIndex + rowIndex,
			height:
				getPdfRowHeight(
					dirtyGroups[rowIndex] ?? null,
					cleanGroups[rowIndex] ?? null,
				) +
				pdfRowVerticalInset * 2,
			startY: 0,
		}));

		globalRowIndex += rowCount;

		return {
			level: level.level,
			levelOrder: level.levelOrder,
			rows,
			rowCount,
			startY: 0,
		} satisfies LevelBand;
	});

	let boardOffset = 0;

	return rawBands.map((band, index) => {
		let rowOffset = boardOffset + bandBorderThickness;
		const rows = band.rows.map((row) => {
			const nextRow = {
				...row,
				startY: rowOffset,
			};

			rowOffset += row.height;
			return nextRow;
		});
		const nextBand = {
			...band,
			rows,
			startY: boardOffset,
		};

		boardOffset +=
			bandBorderThickness +
			rows.reduce((total, row) => total + row.height, 0) +
			(index === rawBands.length - 1 ? bandBorderThickness : 0);

		return nextBand;
	});
}

export function getBoardHeight(bands: LevelBand[]) {
	if (bands.length === 0) return 0;

	return bands.reduce((total, band, index) => {
		const bandHeight = band.rows.reduce((sum, row) => sum + row.height, 0);
		return (
			total +
			bandBorderThickness +
			bandHeight +
			(index === bands.length - 1 ? bandBorderThickness : 0)
		);
	}, 0);
}

export function getShaftExtents(
	bands: LevelBand[],
	side: GraphSide,
	shaft: 1 | 2 | 3 | 4,
) {
	let top: number | null = null;
	let bottom: number | null = null;

	for (const band of bands) {
		for (const row of band.rows) {
			const group = side === "dirty" ? row.dirtyGroup : row.cleanGroup;
			if (!group || getBucketThreadCount(group, shaft) <= 0) {
				continue;
			}

			const nextTop = row.startY + shaftCapInset;
			const nextBottom = row.startY + row.height - shaftCapInset;

			top = top === null ? nextTop : Math.min(top, nextTop);
			bottom = bottom === null ? nextBottom : Math.max(bottom, nextBottom);
		}
	}

	if (top === null || bottom === null || bottom <= top) return null;

	return { top, bottom };
}

function getPdfRowHeight(
	dirtyGroup: GraphGroupView | null,
	cleanGroup: GraphGroupView | null,
) {
	return Math.max(
		getPdfRenderedGroupHeight(dirtyGroup),
		getPdfRenderedGroupHeight(cleanGroup),
		minPdfRowHeight,
	);
}

function getPdfRenderedGroupHeight(group: GraphGroupView | null) {
	if (!group) return minPdfRowHeight;

	return Math.max(
		getPdfImportedRoomBlockHeight(group.primaryRooms.length),
		getPdfManualRoomBlockHeight(group.manualRooms.length),
	);
}

function sortGroupsForPdf(groups: GraphGroupView[]) {
	return [...groups].sort((left, right) => {
		const leftPriority = getZonePriority(left.sourceZone);
		const rightPriority = getZonePriority(right.sourceZone);

		if (leftPriority !== rightPriority) return leftPriority - rightPriority;

		if (left.graphSubzone !== right.graphSubzone) {
			if (left.graphSubzone === "dirty") return -1;
			if (right.graphSubzone === "dirty") return 1;
		}

		return left.sourceZone.localeCompare(right.sourceZone, "ru", {
			numeric: true,
			sensitivity: "base",
		});
	});
}

export function getBucketThreadCount(
	group: GraphGroupView,
	shaft: GraphBucketView["shaft"],
) {
	return (
		group.buckets.find((bucket) => bucket.shaft === shaft)?.threadCount ?? 0
	);
}

export function getShaftX(side: GraphSide) {
	return side === "dirty"
		? {
				1: 168,
				2: 202,
				3: 236,
				4: 270,
			}
		: {
				1: 50,
				2: 84,
				3: 118,
				4: 152,
			};
}

export function getBucketY(count: number, rowHeight: number) {
	const baselineHeight = 140;
	const baselineY =
		count <= 1
			? [70]
			: count === 2
				? [54, 86]
				: count === 3
					? [42, 70, 98]
					: count === 4
						? [32, 56, 80, 104]
						: [24, 46, 68, 90, 112];

	return baselineY.map((value) => (value / baselineHeight) * rowHeight);
}
