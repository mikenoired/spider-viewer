"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { InstallationProcessingGroupView } from "@/lib/installation/shared";

import { ConflictBanner, ProcessingChangeRow } from "./processing-change-row";

type ResolutionState = Record<string, boolean | null>;

function createInitialResolutions(group: InstallationProcessingGroupView | null) {
	const resolutions: ResolutionState = {};

	for (const change of group?.changes ?? []) {
		resolutions[change.id] = change.hasConflict ? null : change.desiredDone;
	}

	return resolutions;
}

function buildResolvedChanges(group: InstallationProcessingGroupView | null, resolutions: ResolutionState) {
	return (group?.changes ?? []).flatMap((change) => {
		const resolvedDone = resolutions[change.id];

		if (resolvedDone === null || resolvedDone === undefined) return [];

		return [
			{
				pendingChangeId: change.id,
				resolvedDone,
			},
		];
	});
}

export function ProcessingGroupSheet({
	group,
	open,
	pending,
	onOpenChange,
	onApply,
}: {
	group: InstallationProcessingGroupView | null;
	open: boolean;
	pending: boolean;
	onOpenChange: (open: boolean) => void;
	onApply: (resolutions: Array<{ pendingChangeId: string; resolvedDone: boolean }>) => Promise<void>;
}) {
	const isMobile = useMediaQuery("(max-width: 767px)");
	const [resolutions, setResolutions] = useState<ResolutionState>(() => createInitialResolutions(group));

	useEffect(() => {
		setResolutions(createInitialResolutions(group));
	}, [group]);

	const resolvedChanges = useMemo(() => buildResolvedChanges(group, resolutions), [group, resolutions]);
	const canApply = group ? resolvedChanges.length === group.changes.length : false;

	if (!group) return null;

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side={isMobile ? "bottom" : "right"}
				className="h-[85svh] max-h-[85svh] w-full gap-0 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)] md:h-full md:max-h-none md:max-w-xl">
				<SheetHeader className="shrink-0 border-b">
					<SheetTitle>{group.name}</SheetTitle>
					<SheetDescription>Проверьте offline-изменения перед переносом в доску.</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-3 p-4">
					{group.hasConflicts ? <ConflictBanner /> : null}
					{group.changes.map((change) => (
						<ProcessingChangeRow
							key={change.id}
							change={change}
							value={resolutions[change.id] ?? null}
							onChange={(nextValue) =>
								setResolutions((current) => ({
									...current,
									[change.id]: nextValue,
								}))
							}
						/>
					))}
				</div>
				<div className="border-t p-4">
					<Button
						type="button"
						className="w-full"
						disabled={!canApply || pending}
						onClick={() => void onApply(resolvedChanges)}>
						Утвердить статус группы KKS
					</Button>
				</div>
			</SheetContent>
		</Sheet>
	);
}
