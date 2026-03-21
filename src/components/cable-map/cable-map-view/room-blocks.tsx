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

	const displayThreadCount = group.threadCount;
	const hasStartedProgress = group.primaryRooms.some(
		(room) => room.progress > 0,
	);

	if (!hasStartedProgress) {
		return (
			<div className="flex h-full items-center justify-center py-4">
				<div className="rounded-[6px] border border-zinc-400/80 bg-[#fffdf3] px-2 py-1 text-center text-[11px] font-semibold text-zinc-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
					{displayThreadCount} н
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full items-center justify-center py-4">
			<div className="flex w-full flex-col gap-1 rounded-[10px] border border-zinc-400/80 bg-[#fffdf3] px-2 py-2 text-center text-zinc-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
				<div className="rounded-[6px] bg-white/70 px-1 py-1 text-[13px] font-semibold leading-none dark:bg-zinc-900/80">
					{group.averageProgress}%
				</div>
				<div className="rounded-[6px] bg-white/55 px-1 py-1 text-[11px] font-semibold leading-none dark:bg-zinc-900/60">
					{displayThreadCount} н
				</div>
				<div className="rounded-[6px] bg-white/40 px-1 py-1 text-[11px] font-semibold leading-none dark:bg-zinc-900/40">
					{formatCopperMass(group.copperMassKg)}
				</div>
			</div>
		</div>
	);
}
