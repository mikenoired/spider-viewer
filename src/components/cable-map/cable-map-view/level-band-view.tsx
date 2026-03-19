import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { boardColumns } from "./config";
import { PathArea } from "./path-layer";
import {
	LeftRoomArea,
	RightRoomArea,
	SchedulePill,
	TotalThreadsBadge,
} from "./room-blocks";
import type { LevelBand } from "./types";
import { findBandGroupForSchedule } from "./utils";

export function LevelBandView({
	band,
	bandIndex,
	nextBand,
	canEditProgress,
	canManageManualRooms,
	isLast,
}: {
	band: LevelBand;
	bandIndex: number;
	nextBand: LevelBand | null;
	canEditProgress: boolean;
	canManageManualRooms: boolean;
	isLast: boolean;
}) {
	const isPairStart = bandIndex % 2 === 0;
	const currentBandHeight = band.rows.reduce(
		(total, row) => total + row.height,
		0,
	);
	const nextBandHeight = nextBand
		? nextBand.rows.reduce((total, row) => total + row.height, 0)
		: 0;
	const pairHeight = currentBandHeight + nextBandHeight;
	const dirtyScheduleSource =
		findBandGroupForSchedule(band, "dirty") ??
		(nextBand ? findBandGroupForSchedule(nextBand, "dirty") : null);
	const cleanScheduleSource =
		findBandGroupForSchedule(band, "clean") ??
		(nextBand ? findBandGroupForSchedule(nextBand, "clean") : null);
	const isFirst = bandIndex === 0;

	return (
		<div
			className={cn(
				"relative grid",
				isLast && "border-b-2",
				!isFirst &&
					"border-t-2 border-dashed border-zinc-400/90 dark:border-zinc-700",
			)}
			style={
				{
					gridTemplateColumns: boardColumns,
					gridTemplateRows: band.rows.map((row) => `${row.height}px`).join(" "),
				} satisfies CSSProperties
			}
		>
			<div
				className="relative flex items-center justify-center border-x-2 border-dashed border-zinc-400/90 px-2 text-center dark:border-zinc-700"
				style={
					{
						gridColumn: "5",
						gridRow: `1 / span ${band.rowCount}`,
					} satisfies CSSProperties
				}
			>
				<div className="text-3xl font-semibold leading-none tracking-[-0.03em] text-zinc-900 dark:text-zinc-100">
					{band.level}
				</div>
			</div>

			{isPairStart ? (
				<>
					<div
						className="relative z-10"
						style={
							{
								gridColumn: "1",
								gridRow: `1 / span ${band.rowCount}`,
							} satisfies CSSProperties
						}
					>
						<SchedulePill
							group={dirtyScheduleSource}
							side="dirty"
							height={pairHeight}
						/>
					</div>

					<div
						className="relative z-10"
						style={
							{
								gridColumn: "9",
								gridRow: `1 / span ${band.rowCount}`,
							} satisfies CSSProperties
						}
					>
						<SchedulePill
							group={cleanScheduleSource}
							side="clean"
							height={pairHeight}
						/>
					</div>
				</>
			) : null}

			{band.rows.map((row, rowIndex) => {
				const gridRow = String(rowIndex + 1);

				return (
					<LevelBandRowView
						key={`${band.level}:${row.globalRowIndex}`}
						dirtyGroup={row.dirtyGroup}
						cleanGroup={row.cleanGroup}
						gridRow={gridRow}
						rowHeight={row.height}
						canEditProgress={canEditProgress}
						canManageManualRooms={canManageManualRooms}
					/>
				);
			})}
		</div>
	);
}

function LevelBandRowView({
	dirtyGroup,
	cleanGroup,
	gridRow,
	rowHeight,
	canEditProgress,
	canManageManualRooms,
}: {
	dirtyGroup: LevelBand["rows"][number]["dirtyGroup"];
	cleanGroup: LevelBand["rows"][number]["cleanGroup"];
	gridRow: string;
	rowHeight: number;
	canEditProgress: boolean;
	canManageManualRooms: boolean;
}) {
	return (
		<>
			<div style={{ gridColumn: "2", gridRow }}>
				<LeftRoomArea
					group={dirtyGroup}
					canEditProgress={canEditProgress}
					canManageManualRooms={canManageManualRooms}
				/>
			</div>

			<div style={{ gridColumn: "3", gridRow }}>
				<TotalThreadsBadge group={dirtyGroup} />
			</div>

			<div className="relative z-10" style={{ gridColumn: "4", gridRow }}>
				<PathArea side="dirty" group={dirtyGroup} height={rowHeight} />
			</div>

			<div className="relative z-10" style={{ gridColumn: "6", gridRow }}>
				<PathArea side="clean" group={cleanGroup} height={rowHeight} />
			</div>

			<div style={{ gridColumn: "7", gridRow }}>
				<TotalThreadsBadge group={cleanGroup} />
			</div>

			<div style={{ gridColumn: "8", gridRow }}>
				<RightRoomArea
					group={cleanGroup}
					canEditProgress={canEditProgress}
					canManageManualRooms={canManageManualRooms}
				/>
			</div>
		</>
	);
}
