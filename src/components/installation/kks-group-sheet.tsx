"use client";

import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { InstallationGroupView, InstallationKksView } from "@/lib/installation/shared";
import { cn } from "@/lib/utils";

export function KksGroupSheet({
	group,
	canEdit,
	open,
	onOpenChange,
	onToggle,
}: {
	group: InstallationGroupView | null;
	canEdit: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onToggle: (groupId: string, item: InstallationKksView, isDone: boolean) => Promise<void>;
}) {
	const isMobile = useMediaQuery("(max-width: 767px)");

	if (!group) return null;

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side={isMobile ? "bottom" : "right"}
				className="h-[85svh] max-h-[85svh] w-full gap-0 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)] md:h-full md:max-h-none md:max-w-lg">
				<SheetHeader className="shrink-0 border-b">
					<SheetTitle>{group.name}</SheetTitle>
					<SheetDescription>
						{group.doneCount} из {group.totalCount} KKS готово
					</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-3 p-4">
					{canEdit ? null : (
						<div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
							Режим просмотра: редактирование монтажа недоступно для вашей роли.
						</div>
					)}
					<div className="overflow-hidden rounded-lg border">
						{group.kksItems.map((item, index) => (
							<KksSwitchRow
								key={item.id}
								item={item}
								canEdit={canEdit}
								striped={index % 2 === 1}
								onToggle={(isDone) => onToggle(group.id, item, isDone)}
							/>
						))}
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}

function KksSwitchRow({
	item,
	canEdit,
	striped,
	onToggle,
}: {
	item: InstallationKksView;
	canEdit: boolean;
	striped: boolean;
	onToggle: (isDone: boolean) => Promise<void>;
}) {
	const itemTypeLabel = item.itemType === "mechanism" ? "Механизм" : "Кабель";
	const sourceLabel = [item.sourceSheet, item.sourceRowIndex ? `стр. ${item.sourceRowIndex}` : ""]
		.filter(Boolean)
		.join(", ");

	return (
		<div
			className={cn(
				"flex min-h-11 items-start justify-between gap-4 border-b px-3 py-2 last:border-b-0",
				striped ? "bg-muted/25" : "bg-background"
			)}>
			<div className="flex min-w-0 flex-1 flex-col gap-1.5">
				<div className="break-words text-sm leading-5 font-medium">{item.name}</div>
				<div className="flex flex-wrap items-center gap-1.5">
					<Badge variant="outline">{itemTypeLabel}</Badge>
					{item.matchedInCableBase ? <Badge variant="secondary">Найдено в базе</Badge> : null}
					{sourceLabel ? (
						<span className="text-xs text-muted-foreground">
							{sourceLabel}
							{item.sourceColumnLabel ? `, ${item.sourceColumnLabel}` : ""}
						</span>
					) : null}
				</div>
			</div>
			<Switch
				checked={item.isDone}
				disabled={!canEdit}
				onCheckedChange={(checked) => void onToggle(checked)}
				aria-label={`Изменить готовность ${item.name}`}
			/>
		</div>
	);
}
