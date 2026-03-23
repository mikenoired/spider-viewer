import type { GraphBucketView } from "@/lib/cable-map/shared"

export const shaftPalette = {
	0: {
		line: "#111827",
		fill: "#6b7280",
	},
	1: {
		line: "#0f84db",
		fill: "#1ea7fd",
	},
	2: {
		line: "#4b9a11",
		fill: "#71c71a",
	},
	3: {
		line: "#ea580c",
		fill: "#ff7a00",
	},
	4: {
		line: "#991b1b",
		fill: "#b1003c",
	},
} as const satisfies Record<
	GraphBucketView["shaft"],
	{
		line: string
		fill: string
	}
>

export const boardColumnWidths = [252, 96, 320, 112, 320, 96, 252] as const
export const boardColumns = boardColumnWidths.map(width => `${width}px`).join(" ")
export const boardWidth = boardColumnWidths.reduce((total, width) => total + width, 0)
export const dirtyPathColumnStart = boardColumnWidths
	.slice(0, 2)
	.reduce((total, width) => total + width, 0)
export const cleanPathColumnStart = boardColumnWidths
	.slice(0, 4)
	.reduce((total, width) => total + width, 0)
export const pathColumnWidth = boardColumnWidths[2]
export const bandBorderThickness = 2
export const shaftCapInset = 4
export const pdfRowVerticalInset = 16
export const minPdfRowHeight = 140
export const pdfRoomGridColumns = 2
export const pdfRoomLineHeight = 16
export const pdfRoomRowGap = 4
export const pdfRoomBlockVerticalPadding = 44
export const manualRoomItemHeight = 30
export const manualRoomItemGap = 4
export const manualRoomBlockVerticalPadding = 20
export const manualRoomActionGap = 8
export const manualRoomActionHeight = 50
export const manualRoomPlaceholderHeight = 140

const levelValuePattern = /^-?\d+(?:,\d+)?$/
const zonePriority: Record<string, number> = {
	ГЗ: 0,
	ЧЗ: 1,
	ГО: 2,
	МЗ: 3,
	РДЭС: 4,
}

export function isLevelValue(level: string) {
	return levelValuePattern.test(level)
}

export function getZonePriority(zone: string) {
	return zonePriority[zone] ?? 99
}

export function getPdfRoomGridRowCount(roomCount: number) {
	return Math.max(1, Math.ceil(roomCount / pdfRoomGridColumns))
}

export function getPdfImportedRoomBlockHeight(importedRoomCount: number) {
	const roomRows = getPdfRoomGridRowCount(importedRoomCount)

	return roomRows * pdfRoomLineHeight + (roomRows - 1) * pdfRoomRowGap + pdfRoomBlockVerticalPadding
}

export function getPdfManualRoomBlockHeight(manualRoomCount: number) {
	if (manualRoomCount <= 0) {
		return manualRoomPlaceholderHeight
	}

	return (
		manualRoomCount * manualRoomItemHeight +
		(manualRoomCount - 1) * manualRoomItemGap +
		manualRoomBlockVerticalPadding +
		manualRoomActionGap +
		manualRoomActionHeight
	)
}
