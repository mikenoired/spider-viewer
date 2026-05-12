import { DownloadIcon, LoaderCircleIcon } from "lucide-react";
import { type CSSProperties, memo } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { boardColumns } from "./config";
import { PathArea } from "./path-layer";
import { LeftRoomArea, RightRoomArea, TotalThreadsBadge } from "./room-blocks";
import type { LevelBand } from "./types";

function getDisplayedLevelLabel(level: string) {
	const normalizedLevel = level.trim().toLowerCase();

	if (normalizedLevel === "#н/д" || normalizedLevel === "н/д") {
		return "";
	}

	return level;
}

export const LevelBandView = memo(function LevelBandView({
	band,
	bandIndex,
	canEditProgress,
	canManageManualRooms,
	onOverlayOpenChange,
	canExportDailyReport,
	isExportDisabled,
	isExportingReport,
	onExportDailyReport,
	isLast,
}: {
	band: LevelBand;
	bandIndex: number;
	canEditProgress: boolean;
	canManageManualRooms: boolean;
	onOverlayOpenChange?: (overlayId: string, open: boolean) => void;
	canExportDailyReport: boolean;
	isExportDisabled: boolean;
	isExportingReport: boolean;
	onExportDailyReport: (level: string) => void;
	isLast: boolean;
}) {
	const isFirst = bandIndex === 0;
	const displayedLevelLabel = getDisplayedLevelLabel(band.level);

	return (
		<div
			className={cn(
				"relative grid",
				isLast && "border-b-2",
				!isFirst && "border-t-2 border-dashed border-zinc-400/90 dark:border-zinc-700"
			)}
			style={
				{
					gridTemplateColumns: boardColumns,
					gridTemplateRows: band.rows.map((row) => `${row.height}px`).join(" "),
				} satisfies CSSProperties
			}>
			<div
				className="relative flex items-center justify-center border-x-2 border-dashed border-zinc-400/90 px-2 text-center dark:border-zinc-700"
				style={
					{
						gridColumn: "4",
						gridRow: `1 / span ${band.rowCount}`,
					} satisfies CSSProperties
				}>
				<div className="flex w-full flex-col items-center gap-3">
					<div className="select-none text-3xl font-semibold leading-none tracking-[-0.03em] text-zinc-900 dark:text-zinc-100">
						{displayedLevelLabel}
					</div>
					{canExportDailyReport ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									size="icon-sm"
									variant="outline"
									onClick={() => void onExportDailyReport(band.level)}
									disabled={isExportDisabled}
									aria-label={
										displayedLevelLabel
											? `Выгрузить DOCX по уровню ${displayedLevelLabel}`
											: "Выгрузить DOCX по уровню"
									}>
									{isExportingReport ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
								</Button>
							</TooltipTrigger>
							<TooltipContent>Выгрузить DOCX</TooltipContent>
						</Tooltip>
					) : null}
				</div>
			</div>

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
						onOverlayOpenChange={onOverlayOpenChange}
					/>
				);
			})}
		</div>
	);
});

const LevelBandRowView = memo(function LevelBandRowView({
	dirtyGroup,
	cleanGroup,
	gridRow,
	rowHeight,
	canEditProgress,
	canManageManualRooms,
	onOverlayOpenChange,
}: {
	dirtyGroup: LevelBand["rows"][number]["dirtyGroup"];
	cleanGroup: LevelBand["rows"][number]["cleanGroup"];
	gridRow: string;
	rowHeight: number;
	canEditProgress: boolean;
	canManageManualRooms: boolean;
	onOverlayOpenChange?: (overlayId: string, open: boolean) => void;
}) {
	return (
		<>
			<div style={{ gridColumn: "1", gridRow }}>
				<LeftRoomArea
					group={dirtyGroup}
					canEditProgress={canEditProgress}
					canManageManualRooms={canManageManualRooms}
					onOverlayOpenChange={onOverlayOpenChange}
				/>
			</div>

			<div style={{ gridColumn: "2", gridRow }}>
				<TotalThreadsBadge group={dirtyGroup} />
			</div>

			<div className="relative z-10" style={{ gridColumn: "3", gridRow }}>
				<PathArea side="dirty" group={dirtyGroup} height={rowHeight} />
			</div>

			<div className="relative z-10" style={{ gridColumn: "5", gridRow }}>
				<PathArea side="clean" group={cleanGroup} height={rowHeight} />
			</div>

			<div style={{ gridColumn: "6", gridRow }}>
				<TotalThreadsBadge group={cleanGroup} />
			</div>

			<div style={{ gridColumn: "7", gridRow }}>
				<RightRoomArea
					group={cleanGroup}
					canEditProgress={canEditProgress}
					canManageManualRooms={canManageManualRooms}
					onOverlayOpenChange={onOverlayOpenChange}
				/>
			</div>
		</>
	);
});

LevelBandView.displayName = "LevelBandView";
LevelBandRowView.displayName = "LevelBandRowView";
