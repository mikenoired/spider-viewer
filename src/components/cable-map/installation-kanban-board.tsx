"use client";

import { useRouter } from "@tanstack/react-router";
import {
	CheckCheckIcon,
	CheckIcon,
	ChevronLeftIcon,
	ClipboardListIcon,
	LoaderCircleIcon,
	UserIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { updatePriorityRoomKanbanStatus } from "@/lib/cable-map/functions";
import type { PriorityKanbanRoomView, PriorityRoomKanbanStatus } from "@/lib/cable-map/shared";
import { cn } from "@/lib/utils";

type KanbanColumn = {
	status: PriorityRoomKanbanStatus;
	title: string;
	description: string;
	icon: React.ReactNode;
};

const kanbanColumns: KanbanColumn[] = [
	{
		status: "in_progress",
		title: "В процессе",
		description: "Задачи на сегодня",
		icon: <ClipboardListIcon className="size-4" />,
	},
	{
		status: "done",
		title: "Выполнено",
		description: "Ожидает проверки",
		icon: <CheckIcon className="size-4" />,
	},
	{
		status: "checked",
		title: "Проверено",
		description: "Подтверждено",
		icon: <CheckCheckIcon className="size-4" />,
	},
];

function getAuthorGroupKey(room: PriorityKanbanRoomView) {
	return room.priorityAuthors.length > 0 ? room.priorityAuthors.join(", ") : "Без автора";
}

function groupInProgressRoomsByAuthor(rooms: PriorityKanbanRoomView[]) {
	const groups = new Map<string, PriorityKanbanRoomView[]>();

	for (const room of rooms) {
		const authorKey = getAuthorGroupKey(room);
		const groupRooms = groups.get(authorKey) ?? [];
		groupRooms.push(room);
		groups.set(authorKey, groupRooms);
	}

	return [...groups.entries()].sort(([left], [right]) =>
		left.localeCompare(right, "ru", {
			numeric: true,
			sensitivity: "base",
		})
	);
}

function canMoveRoom(
	room: PriorityKanbanRoomView,
	targetStatus: PriorityRoomKanbanStatus,
	canVerify: boolean
) {
	if (room.status === targetStatus || room.status === "checked") {
		return false;
	}

	if (targetStatus === "checked") {
		return canVerify && room.status === "done";
	}

	if (room.status === "in_progress" && targetStatus === "done") {
		return true;
	}

	if (room.status === "done" && targetStatus === "in_progress") {
		return true;
	}

	return false;
}

function KanbanRoomCard({
	room,
	canVerify,
	pendingRoomId,
	highlighted,
	onMove,
	onHover,
}: {
	room: PriorityKanbanRoomView;
	canVerify: boolean;
	pendingRoomId: string | null;
	highlighted: boolean;
	onMove: (room: PriorityKanbanRoomView, status: PriorityRoomKanbanStatus) => void;
	onHover: (roomId: string | null) => void;
}) {
	const pending = pendingRoomId === room.roomId;
	const canMoveToInProgress = canMoveRoom(room, "in_progress", canVerify);
	const canMoveToDone = canMoveRoom(room, "done", canVerify);
	const canMoveToChecked = canMoveRoom(room, "checked", canVerify);

	return (
		<div
			draggable={!pending && room.status !== "checked"}
			onDragStart={(event) => {
				event.dataTransfer.setData("application/x-priority-room-id", room.roomId);
				event.dataTransfer.effectAllowed = "move";
			}}
			onMouseEnter={() => onHover(room.roomId)}
			onMouseLeave={() => onHover(null)}
			onFocus={() => onHover(room.roomId)}
			onBlur={() => onHover(null)}
			className={cn(
				"rounded-lg border bg-background p-3 shadow-sm transition",
				highlighted && "border-amber-400 bg-amber-50/70 shadow-md dark:border-amber-500 dark:bg-amber-500/10",
				!pending && room.status !== "checked" && "cursor-grab active:cursor-grabbing"
			)}>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="truncate text-sm font-semibold">{room.roomName}</div>
					<div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
						<span>{room.level}</span>
						<span>{room.sourceZone || "Без зоны"}</span>
						<span>{room.graphSide === "dirty" ? "Откуда" : "Куда"}</span>
					</div>
				</div>
				<Badge variant="outline" className="shrink-0">
					{room.progress}%
				</Badge>
			</div>

			<div className="mt-3 flex flex-wrap gap-1">
				{room.priorityAuthors.map((author) => (
					<Badge key={author} variant="secondary" className="max-w-full truncate">
						{author}
					</Badge>
				))}
			</div>

			<div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
				<span>{room.cableCount} каб.</span>
				<span>{room.threadCount} н.</span>
				{room.checkedByLogin ? <span>Проверил: {room.checkedByLogin}</span> : null}
			</div>

			<div className="mt-3 flex flex-wrap gap-1.5">
				<Button
					type="button"
					size="icon-sm"
					variant="ghost"
					disabled={!canMoveToInProgress || pending}
					onClick={() => onMove(room, "in_progress")}
					aria-label="Вернуть в процесс">
					<ChevronLeftIcon />
				</Button>
				<Button
					type="button"
					size="icon-sm"
					variant="outline"
					disabled={!canMoveToDone || pending}
					onClick={() => onMove(room, "done")}
					aria-label="Перенести в выполнено">
					{pending && canMoveToDone ? <LoaderCircleIcon className="animate-spin" /> : <CheckIcon />}
				</Button>
				<Button
					type="button"
					size="icon-sm"
					variant="outline"
					disabled={!canMoveToChecked || pending}
					onClick={() => onMove(room, "checked")}
					aria-label="Подтвердить проверку">
					{pending && canMoveToChecked ? <LoaderCircleIcon className="animate-spin" /> : <CheckCheckIcon />}
				</Button>
			</div>
		</div>
	);
}

function KanbanColumnView({
	column,
	rooms,
	canVerify,
	pendingRoomId,
	dragOver,
	highlightedRoomId,
	onMove,
	onHover,
	onDropRoom,
}: {
	column: KanbanColumn;
	rooms: PriorityKanbanRoomView[];
	canVerify: boolean;
	pendingRoomId: string | null;
	dragOver: boolean;
	highlightedRoomId: string | null;
	onMove: (room: PriorityKanbanRoomView, status: PriorityRoomKanbanStatus) => void;
	onHover: (roomId: string | null) => void;
	onDropRoom: (roomId: string, status: PriorityRoomKanbanStatus) => void;
}) {
	const authorGroups = useMemo(
		() => (column.status === "in_progress" ? groupInProgressRoomsByAuthor(rooms) : []),
		[column.status, rooms]
	);

	return (
		<div
			onDragOver={(event) => {
				event.preventDefault();
				event.dataTransfer.dropEffect = "move";
			}}
			onDrop={(event) => {
				event.preventDefault();
				const roomId = event.dataTransfer.getData("application/x-priority-room-id");

				if (roomId) {
					onDropRoom(roomId, column.status);
				}
			}}
			className={cn(
				"flex min-h-80 flex-col rounded-lg border bg-muted/20",
				dragOver && "border-amber-400 bg-amber-50/50 dark:border-amber-500 dark:bg-amber-500/10"
			)}>
			<div className="flex items-start justify-between gap-3 border-b px-3 py-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-sm font-semibold">
						{column.icon}
						{column.title}
					</div>
					<div className="text-xs text-muted-foreground">{column.description}</div>
				</div>
				<Badge variant="secondary">{rooms.length}</Badge>
			</div>

			<div className="flex flex-1 flex-col gap-3 p-3">
				{column.status === "in_progress" ? (
					authorGroups.length > 0 ? (
						authorGroups.map(([author, groupRooms]) => (
							<div key={author} className="rounded-lg border bg-background/60 p-2">
								<div className="mb-2 flex items-center justify-between gap-2">
									<div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
										<UserIcon className="size-3.5" />
										<span className="truncate">{author}</span>
									</div>
									<Badge variant="outline">{groupRooms.length}</Badge>
								</div>
								<div className="grid gap-2">
									{groupRooms.map((room) => (
										<KanbanRoomCard
											key={room.roomId}
											room={room}
											canVerify={canVerify}
											pendingRoomId={pendingRoomId}
											highlighted={highlightedRoomId === room.roomId}
											onMove={onMove}
											onHover={onHover}
										/>
									))}
								</div>
							</div>
						))
					) : (
						<div className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
							Нет комнат в работе.
						</div>
					)
				) : rooms.length > 0 ? (
					rooms.map((room) => (
						<KanbanRoomCard
							key={room.roomId}
							room={room}
							canVerify={canVerify}
							pendingRoomId={pendingRoomId}
							highlighted={highlightedRoomId === room.roomId}
							onMove={onMove}
							onHover={onHover}
						/>
					))
				) : (
					<div className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
						Пока пусто.
					</div>
				)}
			</div>
		</div>
	);
}

export function InstallationKanbanBoard({
	rooms,
	canVerify,
	highlightedRoomId,
	onHoverRoom,
}: {
	rooms: PriorityKanbanRoomView[];
	canVerify: boolean;
	highlightedRoomId: string | null;
	onHoverRoom: (roomId: string | null) => void;
}) {
	const router = useRouter();
	const [pendingRoomId, setPendingRoomId] = useState<string | null>(null);
	const [dragOverStatus, setDragOverStatus] = useState<PriorityRoomKanbanStatus | null>(null);

	const roomsByStatus = useMemo(
		() =>
			kanbanColumns.reduce(
				(acc, column) => ({
					...acc,
					[column.status]: rooms.filter((room) => room.status === column.status),
				}),
				{} as Record<PriorityRoomKanbanStatus, PriorityKanbanRoomView[]>
			),
		[rooms]
	);
	const roomsById = useMemo(() => new Map(rooms.map((room) => [room.roomId, room])), [rooms]);

	async function handleMove(room: PriorityKanbanRoomView, status: PriorityRoomKanbanStatus) {
		if (!canMoveRoom(room, status, canVerify)) {
			if (status === "checked") {
				toast.error('В "Проверено" переносит только супер-админ и только из "Выполнено".');
			}
			return;
		}

		setPendingRoomId(room.roomId);

		try {
			await updatePriorityRoomKanbanStatus({
				data: {
					roomId: room.roomId,
					status,
				},
			});
			await router.invalidate();
			toast.success(
				`"${room.roomName}" перенесено в "${kanbanColumns.find((column) => column.status === status)?.title}".`
			);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось изменить статус комнаты.");
		} finally {
			setPendingRoomId(null);
		}
	}

	function handleDropRoom(roomId: string, status: PriorityRoomKanbanStatus) {
		const room = roomsById.get(roomId);
		setDragOverStatus(null);

		if (room) {
			void handleMove(room, status);
		}
	}

	return (
		<Card>
			<CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<CardTitle>Канбан монтажа</CardTitle>
					<CardDescription>
						Перетаскивайте комнаты между колонками. Проверку подтверждает только супер-админ.
					</CardDescription>
				</div>
				<div className="flex flex-wrap gap-2">
					{kanbanColumns.map((column) => (
						<Badge key={column.status} variant="outline">
							{column.title}: {roomsByStatus[column.status].length}
						</Badge>
					))}
				</div>
			</CardHeader>
			<CardContent>
				{rooms.length > 0 ? (
					<div
						className="grid gap-3 xl:grid-cols-3"
						onDragLeave={(event) => {
							if (event.currentTarget === event.target) {
								setDragOverStatus(null);
							}
						}}>
						{kanbanColumns.map((column) => (
							<div
								key={column.status}
								onDragEnter={() => setDragOverStatus(column.status)}
								onDragLeave={(event) => {
									if (event.currentTarget === event.target) {
										setDragOverStatus(null);
									}
								}}>
								<KanbanColumnView
									column={column}
									rooms={roomsByStatus[column.status]}
									canVerify={canVerify}
									pendingRoomId={pendingRoomId}
									dragOver={dragOverStatus === column.status}
									highlightedRoomId={highlightedRoomId}
									onMove={(room, status) => void handleMove(room, status)}
									onHover={onHoverRoom}
									onDropRoom={handleDropRoom}
								/>
							</div>
						))}
					</div>
				) : (
					<div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
						Загрузите список первоочередных помещений, чтобы сформировать канбан монтажа.
					</div>
				)}
			</CardContent>
		</Card>
	);
}
