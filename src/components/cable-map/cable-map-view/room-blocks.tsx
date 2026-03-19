import type { GraphGroupView } from "@/lib/cable-map/shared";
import { GroupProgressSheet } from "../group-progress-sheet";
import { ManualRoomBlock } from "./manual-room-block";
import type { GraphSide } from "./types";

export function SchedulePill({
	group,
	side,
	height,
}: {
	group: GraphGroupView | null;
	side: GraphSide;
	height: number;
}) {
	if (!group) {
		return <div className="h-full" />;
	}

	const label =
		side === "dirty" && group.graphSubzone === "dirty"
			? "6 ч. в день / 6 ч. в ночь"
			: side === "dirty"
				? "10 ч. в день / 10 ч. в ночь"
				: "10 ч. в день / 10 ч. в ночь";

	return (
		<div className="flex items-center justify-center py-3" style={{ height }}>
			<div
				className="flex h-full w-8 items-center justify-center rounded-[10px] border border-zinc-400/80 bg-linear-to-b from-zinc-100 to-zinc-200 px-1 text-[11px] font-medium text-zinc-700 shadow-sm dark:border-zinc-700 dark:from-zinc-900 dark:to-zinc-800 dark:text-zinc-300"
				style={{
					writingMode: "vertical-rl",
					transform: side === "dirty" ? "rotate(180deg)" : undefined,
				}}
			>
				{label}
			</div>
		</div>
	);
}

export function LeftRoomArea({
	group,
	canEditProgress,
	canManageManualRooms,
}: {
	group: GraphGroupView | null;
	canEditProgress: boolean;
	canManageManualRooms: boolean;
}) {
	if (!group) return;

	return (
		<div className="grid h-full grid-cols-[98px_minmax(0,1fr)] gap-3 py-4">
			<ManualRoomBlock group={group} canManage={canManageManualRooms} />
			<GroupProgressSheet
				group={group}
				canEdit={canEditProgress}
				variant="map"
			/>
		</div>
	);
}

export function RightRoomArea({
	group,
	canEditProgress,
	canManageManualRooms,
}: {
	group: GraphGroupView | null;
	canEditProgress: boolean;
	canManageManualRooms: boolean;
}) {
	if (!group) return;

	return (
		<div className="grid h-full grid-cols-[minmax(0,1fr)_98px] gap-3 py-4">
			<GroupProgressSheet
				group={group}
				canEdit={canEditProgress}
				variant="map"
				align="right"
			/>
			<ManualRoomBlock
				group={group}
				canManage={canManageManualRooms}
				className="h-full"
			/>
		</div>
	);
}

export function TotalThreadsBadge({ group }: { group: GraphGroupView | null }) {
	if (!group) {
		return <div className="h-full" />;
	}

	return (
		<div className="flex h-full items-center justify-center py-4">
			<div className="rounded-[6px] border border-zinc-400/80 bg-[#fffdf3] px-2 py-1 text-center text-[11px] font-semibold text-zinc-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
				{group.threadCount} н
			</div>
		</div>
	);
}
