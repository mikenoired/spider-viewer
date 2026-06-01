import { memo } from "react";

import type { GraphGroupView } from "@/lib/cable-map/shared";

import { GroupProgressSheet } from "../group-progress-sheet";
import { ManualRoomBlock } from "./manual-room-block";

function formatCopperMass(valueKg: number) {
	if (valueKg >= 1000) {
		return `${(valueKg / 1000).toFixed(2).replace(".", ",")} т`;
	}

	if (valueKg >= 100) {
		return `${Math.round(valueKg)} кг`;
	}

	return `${valueKg.toFixed(1).replace(".", ",")} кг`;
}

export const LeftRoomArea = memo(function LeftRoomArea({
	group,
	canEditProgress,
	canManageManualRooms,
	onOverlayOpenChange,
}: {
	group: GraphGroupView | null;
	canEditProgress: boolean;
	canManageManualRooms: boolean;
	onOverlayOpenChange?: (overlayId: string, open: boolean) => void;
}) {
	if (!group) return;

	return (
		<div className="grid h-full grid-cols-[98px_minmax(0,1fr)] gap-3 py-4">
			<ManualRoomBlock
				group={group}
				canManage={canManageManualRooms}
				onOverlayOpenChange={onOverlayOpenChange}
			/>
			<GroupProgressSheet
				group={group}
				canEdit={canEditProgress}
				variant="map"
				onOverlayOpenChange={onOverlayOpenChange}
			/>
		</div>
	);
});

export const RightRoomArea = memo(function RightRoomArea({
	group,
	canEditProgress,
	canManageManualRooms,
	onOverlayOpenChange,
}: {
	group: GraphGroupView | null;
	canEditProgress: boolean;
	canManageManualRooms: boolean;
	onOverlayOpenChange?: (overlayId: string, open: boolean) => void;
}) {
	if (!group) return;

	return (
		<div className="grid h-full grid-cols-[minmax(0,1fr)_98px] gap-3 py-4">
			<GroupProgressSheet
				group={group}
				canEdit={canEditProgress}
				variant="map"
				align="right"
				onOverlayOpenChange={onOverlayOpenChange}
			/>
			<ManualRoomBlock
				group={group}
				canManage={canManageManualRooms}
				className="h-full"
				onOverlayOpenChange={onOverlayOpenChange}
			/>
		</div>
	);
});

export const TotalThreadsBadge = memo(function TotalThreadsBadge({
	group,
}: {
	group: GraphGroupView | null;
}) {
	if (!group) {
		return <div className="h-full" />;
	}

	const displayThreadCount = group.threadCount;
	const hasStartedProgress = group.primaryRooms.some((room) => room.progress > 0);

	if (!hasStartedProgress) {
		return (
			<div className="flex h-full items-center justify-center py-4">
				<span className="rounded-md border border-zinc-400/80 bg-[#fffdf3] px-2 py-1 text-center text-[11px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 select-none">
					{displayThreadCount} н
				</span>
			</div>
		);
	}

	return (
		<div className="flex h-full items-center justify-center py-4">
			<div className="flex w-full flex-col gap-1 rounded-lg border border-zinc-400/80 bg-[#fffdf3] px-2 py-2 text-center text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
				<span className="rounded-[6px] bg-white/70 px-1 py-1 text-[13px] font-semibold leading-none dark:bg-zinc-900/80 select-none">
					{group.averageProgress}%
				</span>
				<span className="rounded-[6px] bg-white/55 px-1 py-1 text-[11px] font-semibold leading-none dark:bg-zinc-900/60 select-none">
					{displayThreadCount} н
				</span>
				<span className="rounded-[6px] bg-white/40 px-1 py-1 text-[11px] font-semibold leading-none dark:bg-zinc-900/40 select-none">
					{formatCopperMass(group.copperMassKg)}
				</span>
			</div>
		</div>
	);
});

LeftRoomArea.displayName = "LeftRoomArea";
RightRoomArea.displayName = "RightRoomArea";
TotalThreadsBadge.displayName = "TotalThreadsBadge";
