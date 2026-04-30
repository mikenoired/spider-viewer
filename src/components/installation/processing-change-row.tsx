"use client";

import { TriangleAlertIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { InstallationPendingChangeView } from "@/lib/installation/shared";
import { cn } from "@/lib/utils";

function getStatusLabel(value: boolean) {
	return value ? "Готово" : "Не готово";
}

export function ConflictBanner() {
	return (
		<div className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
			<TriangleAlertIcon className="mt-0.5 shrink-0 text-destructive" />
			<div>
				<div className="font-medium">Решите конфликт слияния перед сохранением в доске</div>
				<div className="text-muted-foreground">Выберите серверное состояние или offline-изменение.</div>
			</div>
		</div>
	);
}

export function ProcessingChangeRow({
	change,
	value,
	onChange,
}: {
	change: InstallationPendingChangeView;
	value: boolean | null;
	onChange: (value: boolean) => void;
}) {
	return (
		<div className="flex flex-col gap-3 rounded-lg border bg-background p-3">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0 text-sm font-medium break-words">{change.kksName}</div>
				{change.hasConflict ? (
					<Badge variant="destructive">Конфликт</Badge>
				) : (
					<Badge variant="secondary">Без конфликта</Badge>
				)}
			</div>
			<div className="grid gap-2 sm:grid-cols-2">
				<ChoiceButton
					active={value === change.serverDone}
					label="Сервер"
					value={getStatusLabel(change.serverDone)}
					onClick={() => onChange(change.serverDone)}
				/>
				<ChoiceButton
					active={value === change.desiredDone}
					label="Offline"
					value={getStatusLabel(change.desiredDone)}
					onClick={() => onChange(change.desiredDone)}
				/>
			</div>
		</div>
	);
}

function ChoiceButton({
	active,
	label,
	value,
	onClick,
}: {
	active: boolean;
	label: string;
	value: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50",
				active && "border-primary bg-primary text-primary-foreground hover:bg-primary"
			)}>
			<div className="text-xs opacity-80">{label}</div>
			<div className="font-medium">{value}</div>
		</button>
	);
}
