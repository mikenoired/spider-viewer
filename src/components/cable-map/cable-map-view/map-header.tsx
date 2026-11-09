import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	graphSideLabelsBySnapshotKind,
	graphSubzoneLabelsBySnapshotKind,
	mapTitleBySnapshotKind,
	type SnapshotKind,
} from "@/lib/cable-map/shared";

import type { GraphSide } from "./types";
import { getShaftX } from "./utils";

export function MapTitle({ snapshotKind }: { snapshotKind: SnapshotKind }) {
	const sideLabels = graphSideLabelsBySnapshotKind[snapshotKind];

	return (
		<div className="space-y-1 text-center">
			<div className="text-[30px] font-semibold leading-tight text-zinc-950 dark:text-zinc-50 select-none">
				{mapTitleBySnapshotKind[snapshotKind]}
			</div>
			<div className="grid grid-cols-[1fr_auto_1fr] items-end gap-6 text-balance">
				<div className="text-[18px] font-semibold leading-tight text-zinc-900 dark:text-zinc-100 select-none">
					{sideLabels.dirty}
				</div>
				<div className="w-24" />
				<div className="text-[18px] font-semibold leading-tight text-zinc-900 dark:text-zinc-100 select-none">
					{sideLabels.clean}
				</div>
			</div>
		</div>
	);
}

export function LeftZoneHeader({ snapshotKind }: { snapshotKind: SnapshotKind }) {
	const subzoneLabels = graphSubzoneLabelsBySnapshotKind[snapshotKind];

	return (
		<div className="grid h-11 grid-cols-[98px_minmax(0,1fr)] items-center gap-3 pb-1 text-center text-base font-semibold text-zinc-700 dark:text-zinc-300">
			<span className="select-none">{subzoneLabels.dirty}</span>
			<div />
		</div>
	);
}

export function RightZoneHeader({ snapshotKind }: { snapshotKind: SnapshotKind }) {
	const subzoneLabels = graphSubzoneLabelsBySnapshotKind[snapshotKind];

	return (
		<div className="grid h-11 grid-cols-[minmax(0,1fr)_98px] items-center gap-3 pb-1 text-center text-base font-semibold text-zinc-700 dark:text-zinc-300">
			<div />
			<span className="select-none">{subzoneLabels.clean}</span>
		</div>
	);
}

export function PathHeader({ side }: { side: GraphSide }) {
	const shaftX = getShaftX(side);
	const guideOpacity = side === "dirty" ? 0.28 : 0.24;

	return (
		<svg viewBox="0 0 320 44" className="h-11 w-full text-zinc-700 dark:text-zinc-300" role="presentation">
			{side === "dirty" ? (
				<line x1={132} y1={0} x2={132} y2={44} stroke="currentColor" strokeWidth="3" />
			) : null}

			{([1, 2, 3, 4] as const).map((shaft) => (
				<g key={shaft}>
					<line
						x1={shaftX[shaft]}
						y1={0}
						x2={shaftX[shaft]}
						y2={44}
						stroke="currentColor"
						strokeWidth="1"
						strokeDasharray="4 5"
						opacity={guideOpacity}
					/>
					<text
						x={shaftX[shaft]}
						y={16}
						fontSize="11"
						fontWeight="700"
						fill="currentColor"
						textAnchor="middle"
						className="select-none">
						КШ
					</text>
					<text
						x={shaftX[shaft]}
						y={31}
						fontSize="12"
						fontWeight="700"
						fill="currentColor"
						textAnchor="middle"
						className="select-none">
						№ {shaft}
					</text>
				</g>
			))}
		</svg>
	);
}

export function SummaryCard({
	title,
	value,
	description,
}: {
	title: string;
	value: string;
	description: string;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-2 px-1 py-2">
			<div className="text-xs font-medium tracking-wide text-muted-foreground">{title}</div>
			<div className="truncate text-2xl font-semibold leading-tight text-foreground">{value}</div>
			<div className="text-sm leading-snug text-muted-foreground">{description}</div>
		</div>
	);
}
