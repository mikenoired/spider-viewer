"use client";

import { CheckCircle2Icon, CircleDashedIcon, HammerIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
	installationColumnLabels,
	type InstallationGroupView,
	type InstallationVisibleColumnId,
} from "@/lib/installation/shared";
import { cn } from "@/lib/utils";

import { KksGroupCard } from "./kks-group-card";

const columnStyles = {
	not_started: {
		icon: CircleDashedIcon,
		className: "border-muted-foreground/20 bg-muted/20",
		headerClassName: "text-muted-foreground",
		iconClassName: "bg-muted text-muted-foreground",
		cardClassName: "border-muted-foreground/20 bg-background/88 hover:bg-muted/45",
	},
	in_progress: {
		icon: HammerIcon,
		className: "border-chart-2/25 bg-chart-2/6",
		headerClassName: "text-chart-2",
		iconClassName: "bg-chart-2/12 text-chart-2",
		cardClassName: "border-chart-2/30 bg-chart-2/8 hover:bg-chart-2/12",
	},
	done: {
		icon: CheckCircle2Icon,
		className: "border-chart-4/30 bg-chart-4/8",
		headerClassName: "text-chart-4",
		iconClassName: "bg-chart-4/14 text-chart-4",
		cardClassName: "border-chart-4/35 bg-chart-4/10 hover:bg-chart-4/14",
	},
} as const;

export function InstallationColumn({
	columnId,
	groups,
	onGroupOpen,
}: {
	columnId: InstallationVisibleColumnId;
	groups: InstallationGroupView[];
	onGroupOpen: (group: InstallationGroupView) => void;
}) {
	const style = columnStyles[columnId];
	const Icon = style.icon;

	return (
		<section
			className={cn(
				"flex min-h-0 w-[20rem] shrink-0 flex-col gap-3 rounded-lg border p-3 sm:w-[22rem]",
				style.className
			)}>
			<div className="flex items-center justify-between gap-3">
				<h2 className={cn("flex items-center gap-2 text-sm font-medium", style.headerClassName)}>
					<span className={cn("flex size-7 items-center justify-center rounded-md", style.iconClassName)}>
						<Icon className="size-5" />
					</span>
					{installationColumnLabels[columnId]}
				</h2>
				<Badge variant="secondary">{groups.length}</Badge>
			</div>
			<div className="flex min-h-0 flex-col gap-2 overflow-auto pr-1">
				{groups.length > 0 ? (
					groups.map((group) => (
						<KksGroupCard
							key={group.id}
							group={group}
							className={style.cardClassName}
							onOpen={() => onGroupOpen(group)}
						/>
					))
				) : (
					<div className="rounded-lg border border-dashed px-3 py-6 text-sm text-muted-foreground">
						Нет карточек.
					</div>
				)}
			</div>
		</section>
	);
}
