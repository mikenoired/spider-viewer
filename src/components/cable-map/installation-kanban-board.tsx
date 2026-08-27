"use client";

import { useRouter } from "@tanstack/react-router";
import { ClipboardListIcon, LoaderCircleIcon, MessageSquarePlusIcon, UserIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { updatePriorityListKanbanStatus } from "@/lib/cable-map/functions";
import type { PriorityListKanbanStatus, PriorityRoomListView } from "@/lib/cable-map/shared";
import { cn } from "@/lib/utils";

const columns: Array<{ status: PriorityListKanbanStatus; title: string; description: string }> = [
	{ status: "formed", title: "Список сформирован", description: "Новый загруженный список" },
	{ status: "in_progress", title: "Список в работе", description: "Работы выполняются" },
	{ status: "curator_review", title: "На проверку куратору", description: "Ожидает решения" },
	{ status: "adjustment", title: "Список в наладке", description: "Требует доработки" },
	{ status: "done", title: "Список выполнен", description: "Работы завершены" },
];

function ListCard({
	list,
	canManage,
	pending,
	onMove,
}: {
	list: PriorityRoomListView;
	canManage: boolean;
	pending: boolean;
	onMove: (list: PriorityRoomListView, status: PriorityListKanbanStatus) => void;
}) {
	return (
		<div
			draggable={canManage && !pending}
			onDragStart={(event) => {
				event.dataTransfer.setData("application/x-priority-list-id", list.id);
				event.dataTransfer.effectAllowed = "move";
			}}
			className={cn(
				"rounded-lg border bg-background p-3 shadow-sm",
				canManage && !pending && "cursor-grab active:cursor-grabbing"
			)}>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="truncate text-sm font-semibold">{list.fileName}</div>
					<div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
						<UserIcon className="size-3.5" />
						<span className="truncate">Автор: {list.authorName}</span>
					</div>
				</div>
				<Badge variant="outline" className="shrink-0">
					{list.roomCount}
				</Badge>
			</div>
			<div className="mt-3 text-xs text-muted-foreground">Загрузил: {list.importedByLogin}</div>
			{list.statusUpdatedByLogin ? (
				<div className="mt-1 text-xs text-muted-foreground">Статус изменил: {list.statusUpdatedByLogin}</div>
			) : null}
			{canManage ? (
				<div className="mt-3 flex flex-wrap gap-1">
					{columns
						.filter((column) => column.status !== list.status)
						.map((column) => (
							<Button
								key={column.status}
								type="button"
								size="sm"
								variant="outline"
								disabled={pending}
								onClick={() => onMove(list, column.status)}>
								{pending ? <LoaderCircleIcon className="animate-spin" /> : null}
								{column.title.replace("Список ", "")}
							</Button>
						))}
				</div>
			) : null}
		</div>
	);
}

export function InstallationKanbanBoard({
	lists,
	canManage,
}: {
	lists: PriorityRoomListView[];
	canManage: boolean;
}) {
	const router = useRouter();
	const [pendingListId, setPendingListId] = useState<string | null>(null);
	const [dragOverStatus, setDragOverStatus] = useState<PriorityListKanbanStatus | null>(null);
	const listsByStatus = useMemo(
		() =>
			Object.fromEntries(
				columns.map((column) => [column.status, lists.filter((list) => list.status === column.status)])
			) as Record<PriorityListKanbanStatus, PriorityRoomListView[]>,
		[lists]
	);
	const listsById = useMemo(() => new Map(lists.map((list) => [list.id, list])), [lists]);

	async function move(list: PriorityRoomListView, status: PriorityListKanbanStatus) {
		if (!canManage || list.status === status) return;
		setPendingListId(list.id);
		try {
			await updatePriorityListKanbanStatus({ data: { listId: list.id, status } });
			await router.invalidate();
			toast.success(`Список перенесён: ${columns.find((column) => column.status === status)?.title}.`);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось изменить статус списка.");
		} finally {
			setPendingListId(null);
		}
	}

	return (
		<Card>
			<CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<CardTitle className="flex items-center gap-2">
						<ClipboardListIcon className="size-4" />
						Канбан списков
					</CardTitle>
					<CardDescription>
						Карточка — загруженный список с автором. Перемещать списки между этапами могут только
						супер-админы.
					</CardDescription>
				</div>
				<Button asChild variant="outline" size="sm">
					<a href="/app/remarks">
						<MessageSquarePlusIcon />
						Замечания
					</a>
				</Button>
			</CardHeader>
			<CardContent>
				<div className="grid gap-3 2xl:grid-cols-5">
					{columns.map((column) => (
						<div
							key={column.status}
							onDragEnter={() => setDragOverStatus(column.status)}
							onDragOver={(event) => event.preventDefault()}
							onDrop={(event) => {
								event.preventDefault();
								setDragOverStatus(null);
								const list = listsById.get(event.dataTransfer.getData("application/x-priority-list-id"));
								if (list) void move(list, column.status);
							}}
							className={cn(
								"flex min-h-72 flex-col rounded-lg border bg-muted/20",
								dragOverStatus === column.status && "border-amber-400 bg-amber-50/50"
							)}>
							<div className="border-b p-3">
								<div className="flex items-start justify-between gap-2 text-sm font-semibold">
									<span>{column.title}</span>
									<Badge variant="secondary">{listsByStatus[column.status].length}</Badge>
								</div>
								<div className="mt-1 text-xs text-muted-foreground">{column.description}</div>
							</div>
							<div className="grid flex-1 content-start gap-2 p-3">
								{listsByStatus[column.status].map((list) => (
									<ListCard
										key={list.id}
										list={list}
										canManage={canManage}
										pending={pendingListId === list.id}
										onMove={move}
									/>
								))}
								{listsByStatus[column.status].length === 0 ? (
									<div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
										Пока пусто.
									</div>
								) : null}
							</div>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	);
}
