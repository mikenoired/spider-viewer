"use client";

import { Badge } from "@/components/ui/badge";
import { installationColumnLabels, type InstallationProcessingGroupView } from "@/lib/installation/shared";

export function ProcessingColumn({
	groups,
	onOpen,
}: {
	groups: InstallationProcessingGroupView[];
	onOpen: (group: InstallationProcessingGroupView) => void;
}) {
	if (groups.length === 0) return null;

	return (
		<section className="flex flex-col gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
			<div className="flex items-center justify-between gap-3">
				<h2 className="text-sm font-medium">{installationColumnLabels.processing}</h2>
				<Badge variant="secondary">{groups.length}</Badge>
			</div>
			<div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
				{groups.map((group) => (
					<ProcessingCard key={group.id} group={group} onOpen={() => onOpen(group)} />
				))}
			</div>
		</section>
	);
}

function ProcessingCard({ group, onOpen }: { group: InstallationProcessingGroupView; onOpen: () => void }) {
	return (
		<button
			type="button"
			onClick={onOpen}
			className="rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50">
			<div className="text-sm font-medium">{group.name}</div>
			<div className="mt-2 flex flex-wrap gap-2">
				<Badge variant="outline">
					{group.doneCount} из {group.totalCount}
				</Badge>
				{group.hasConflicts ? <Badge variant="destructive">Конфликт</Badge> : null}
			</div>
		</button>
	);
}
