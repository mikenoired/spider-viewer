"use client";

import { Progress } from "@/components/ui/progress";
import { shouldShowInstallationProgress, type InstallationGroupView } from "@/lib/installation/shared";
import { cn } from "@/lib/utils";

export function KksGroupCard({
	group,
	onOpen,
	className,
}: {
	group: InstallationGroupView;
	onOpen: () => void;
	className?: string;
}) {
	const showProgress = shouldShowInstallationProgress(group);

	return (
		<button
			type="button"
			onClick={onOpen}
			className={cn(
				"flex w-full flex-col gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50",
				className
			)}>
			<div className="text-sm font-medium text-foreground">{group.name}</div>
			{showProgress ? (
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
						<span>{group.progressPercent}%</span>
						<span>
							{group.doneCount} из {group.totalCount}
						</span>
					</div>
					<Progress value={group.progressPercent} />
				</div>
			) : null}
		</button>
	);
}
