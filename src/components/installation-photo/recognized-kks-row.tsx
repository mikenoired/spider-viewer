"use client";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { InstallationPhotoCandidate } from "@/lib/installation-photo/shared";

export function RecognizedKksRow({
	candidate,
	disabled,
	onSelectedChange,
}: {
	candidate: InstallationPhotoCandidate;
	disabled: boolean;
	onSelectedChange: (selected: boolean) => void;
}) {
	return (
		<label className="flex min-h-12 items-start gap-3 border-b px-3 py-2 last:border-b-0">
			<Checkbox
				checked={candidate.selected}
				disabled={disabled}
				onCheckedChange={(checked) => onSelectedChange(checked === true)}
				aria-label={`Выбрать ${candidate.kksName}`}
			/>
			<span className="min-w-0 flex-1">
				<span className="block break-words text-sm leading-5 font-medium">{candidate.kksName}</span>
				<span className="block text-xs text-muted-foreground">{candidate.groupName}</span>
			</span>
			<span className="flex shrink-0 flex-col items-end gap-1">
				<Badge variant="outline">{candidate.confidence}%</Badge>
				{candidate.markerScore > 0 ? (
					<Badge variant="secondary">маркер {candidate.markerScore}%</Badge>
				) : null}
			</span>
		</label>
	);
}
