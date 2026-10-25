"use client";

import { CloudOffIcon, RefreshCcwIcon, WifiIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function InstallationStatusBar({
	isOnline,
	outboxCount,
	staleOutboxCount,
	onRefresh,
}: {
	isOnline: boolean;
	outboxCount: number;
	staleOutboxCount: number;
	onRefresh: () => void;
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant={isOnline ? "secondary" : "outline"}>
					{isOnline ? <WifiIcon data-icon="inline-start" /> : <CloudOffIcon data-icon="inline-start" />}
					{isOnline ? "Онлайн" : "Оффлайн"}
				</Badge>
				{outboxCount > 0 ? <Badge variant="outline">Офлайн-изменений: {outboxCount}</Badge> : null}
				{staleOutboxCount > 0 ? (
					<span className="text-sm text-muted-foreground">
						Изменений из прежних наборов: {staleOutboxCount}. Сохранены локально.
					</span>
				) : null}
			</div>
			<Button type="button" variant="outline" onClick={onRefresh}>
				<RefreshCcwIcon data-icon="inline-start" />
				Обновить
			</Button>
		</div>
	);
}
