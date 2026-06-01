"use client";

import { useRouter } from "@tanstack/react-router";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
	CalendarIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	LoaderCircleIcon,
	RotateCcwIcon,
	SaveIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { saveCableProgress } from "@/lib/cable-map/functions";
import type { GraphCableView, GraphGroupView } from "@/lib/cable-map/shared";
import { shaftBucketLabels } from "@/lib/cable-map/shared";
import { cn } from "@/lib/utils";

type DraftCable = GraphCableView;

type DraftRoom = {
	id: string;
	roomName: string;
	cableCount: number;
	threadCount: number;
	totalLength: number;
	cables: DraftCable[];
};

function getTodayInMoscow() {
	return new Intl.DateTimeFormat("sv-SE", {
		timeZone: "Europe/Moscow",
	}).format(new Date());
}

function parseIsoDate(value: string | null) {
	if (!value) return undefined;

	const date = new Date(`${value}T12:00:00+03:00`);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

function clampProgress(value: number) {
	if (Number.isNaN(value)) return 0;

	return Math.min(100, Math.max(0, Math.round(value)));
}

function createDraftRooms(group: GraphGroupView): DraftRoom[] {
	return group.primaryRooms.map((room) => ({
		id: room.id,
		roomName: room.roomName,
		cableCount: room.cableCount,
		threadCount: room.threadCount,
		totalLength: room.totalLength,
		cables: room.cables.map((cable) => ({ ...cable })),
	}));
}

function getRoomProgress(room: DraftRoom | GraphGroupView["primaryRooms"][number]) {
	if (room.cables.length === 0) {
		return 0;
	}

	return Math.round(room.cables.reduce((total, cable) => total + cable.progress, 0) / room.cables.length);
}

function getAverageProgress(rooms: DraftRoom[]) {
	if (rooms.length === 0) {
		return 0;
	}

	return Math.round(rooms.reduce((total, room) => total + getRoomProgress(room), 0) / rooms.length);
}

function buildCableProgressById(primaryRooms: GraphGroupView["primaryRooms"]) {
	return new Map(
		primaryRooms.flatMap((room) => room.cables.map((cable) => [cable.id, cable.progress] as const))
	);
}

function buildChangedCables(draftRooms: DraftRoom[], cableProgressById: Map<string, number>) {
	return draftRooms.flatMap((room) =>
		room.cables.flatMap((cable) => {
			const sourceProgress = cableProgressById.get(cable.id);

			if (sourceProgress === undefined || sourceProgress === cable.progress) {
				return [];
			}

			return [
				{
					roomId: room.id,
					cableId: cable.id,
					progress: cable.progress,
				},
			];
		})
	);
}

function useGroupProgressDraft(group: GraphGroupView, open: boolean) {
	const [draftRooms, setDraftRooms] = useState<DraftRoom[]>(() => createDraftRooms(group));
	const [effectiveDate, setEffectiveDate] = useState<string | null>(getTodayInMoscow());

	const reset = useCallback(() => {
		setDraftRooms(createDraftRooms(group));
		setEffectiveDate(getTodayInMoscow());
	}, [group]);

	useEffect(() => {
		if (!open) {
			reset();
		}
	}, [open, reset]);

	const cableProgressById = useMemo(() => buildCableProgressById(group.primaryRooms), [group.primaryRooms]);

	const changedCables = useMemo(
		() => buildChangedCables(draftRooms, cableProgressById),
		[draftRooms, cableProgressById]
	);

	function updateCableProgress(roomId: string, cableId: string, progress: number) {
		setDraftRooms((current) =>
			current.map((room) =>
				room.id === roomId
					? {
							...room,
							cables: room.cables.map((cable) =>
								cable.id === cableId
									? {
											...cable,
											progress: clampProgress(progress),
										}
									: cable
							),
						}
					: room
			)
		);
	}

	return {
		draftRooms,
		effectiveDate,
		setEffectiveDate,
		changedCables,
		isDirty: changedCables.length > 0,
		updateCableProgress,
		reset,
	};
}

function GroupProgressTrigger({
	group,
	variant,
	align,
	className,
	hasRooms,
	onOpen,
}: {
	group: GraphGroupView;
	variant: "default" | "map";
	align: "left" | "right";
	className?: string;
	hasRooms: boolean;
	onOpen: () => void;
}) {
	return (
		<div className="flex w-full items-center justify-center">
			<button
				type="button"
				onClick={onOpen}
				className={cn(
					variant === "map"
						? "relative flex h-full w-full flex-col rounded-lg border border-zinc-400/80 bg-white/90 px-3 py-2 text-left text-zinc-900 transition hover:border-zinc-500 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950/80 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-800 cursor-pointer"
						: "flex min-h-40 w-full flex-col gap-3 rounded-lg border border-border bg-card p-4 text-left transition hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60",
					!hasRooms && "pointer-events-none",
					className
				)}
				disabled={!hasRooms}>
				{variant === "map" ? (
					<div
						className={cn(
							"grid grid-cols-2 gap-x-2 gap-y-1 overflow-hidden text-xs font-medium leading-4 text-zinc-700 dark:text-zinc-200",
							align === "right" && "text-right"
						)}>
						{group.primaryRooms.map((room) => (
							<span key={room.id} className="select-none">
								{room.roomName.length > 15 ? `${room.roomName.slice(0, 15)}...` : room.roomName}
							</span>
						))}
					</div>
				) : (
					<>
						<div className="flex items-start justify-between gap-3">
							<div className="flex flex-col gap-1">
								<div className="text-xs uppercase text-muted-foreground">Основной блок помещений</div>
								<div className="text-sm font-medium">{group.primaryRooms.length} помещений</div>
							</div>
							<Badge variant="secondary">{group.averageProgress}%</Badge>
						</div>
						<div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
							{group.primaryRooms.slice(0, 8).map((room) => (
								<div key={room.id} className="truncate rounded-lg bg-muted/60 px-2 py-1.5">
									{room.roomName}
								</div>
							))}
						</div>
						{group.primaryRooms.length > 8 ? (
							<div className="text-xs text-muted-foreground">
								Ещё {group.primaryRooms.length - 8} помещений
							</div>
						) : null}
					</>
				)}
			</button>
		</div>
	);
}

function GroupProgressControls({
	canEdit,
	pending,
	isDirty,
	effectiveDate,
	onSave,
	onReset,
	onDateChange,
}: {
	canEdit: boolean;
	pending: boolean;
	isDirty: boolean;
	effectiveDate: string | null;
	onSave: () => void;
	onReset: () => void;
	onDateChange: (value: string | null) => void;
}) {
	if (!canEdit) {
		return (
			<div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
				Режим просмотра: редактирование доступно только админам и супер-админам.
			</div>
		);
	}

	return (
		<div className="grid gap-2 rounded-lg border bg-muted/30 p-3 sm:flex sm:flex-wrap sm:items-center">
			<Button type="button" onClick={onSave} disabled={!isDirty || pending} className="h-10 sm:h-8">
				{pending ? (
					<LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
				) : (
					<SaveIcon data-icon="inline-start" />
				)}
				Сохранить
			</Button>

			<Popover>
				<PopoverTrigger asChild>
					<Button type="button" variant="outline" className="h-10 justify-between sm:h-8 sm:justify-center">
						<CalendarIcon data-icon="inline-start" />
						{effectiveDate
							? format(parseIsoDate(effectiveDate) ?? new Date(), "d MMMM yyyy", {
									locale: ru,
								})
							: "Выбрать дату"}
					</Button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))]">
					<PopoverHeader>
						<PopoverTitle>Дата изменения</PopoverTitle>
					</PopoverHeader>
					<Calendar
						mode="single"
						selected={parseIsoDate(effectiveDate)}
						onSelect={(value) => onDateChange(value ? format(value, "yyyy-MM-dd") : getTodayInMoscow())}
						className="w-full"
					/>
				</PopoverContent>
			</Popover>

			<Button
				type="button"
				variant="ghost"
				onClick={onReset}
				disabled={!isDirty || pending}
				className="h-10 sm:h-8">
				<RotateCcwIcon data-icon="inline-start" />
				Отменить изменения
			</Button>
		</div>
	);
}

function CableProgressEditor({
	roomId,
	cable,
	canEdit,
	pending,
	onProgressChange,
}: {
	roomId: string;
	cable: DraftCable;
	canEdit: boolean;
	pending: boolean;
	onProgressChange: (roomId: string, cableId: string, progress: number) => void;
}) {
	const metaParts = [cable.cableNumber, cable.cableJournal].filter(Boolean);

	return (
		<div className="grid gap-3 rounded-lg border bg-background/80 p-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] sm:items-center">
			<div className="min-w-0 space-y-2">
				<div className="flex flex-wrap items-center gap-2">
					<div className="min-w-0 flex-1 text-sm font-medium break-words text-foreground">
						{cable.cableLabel}
					</div>
					<Badge variant="outline">{shaftBucketLabels[cable.shaft]}</Badge>
				</div>
				<div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
					{metaParts.length > 0 ? <span>{metaParts.join(" / ")}</span> : null}
					<span>Куда: {cable.toRoom || "-"}</span>
					<span>Ниток: {cable.threadCount}</span>
					<span>Длина: {Math.round(cable.totalLength)} м</span>
				</div>
			</div>

			<div className="grid min-w-0 gap-3 sm:grid-cols-[1fr_84px] sm:items-center">
				<Slider
					value={[cable.progress]}
					onValueChange={(value) => onProgressChange(roomId, cable.id, value[0] ?? 0)}
					disabled={!canEdit || pending}
					max={100}
					min={0}
					step={1}
				/>
				<Input
					type="number"
					min={0}
					max={100}
					value={cable.progress}
					className="h-10 sm:h-8"
					onChange={(event) => onProgressChange(roomId, cable.id, Number(event.target.value))}
					disabled={!canEdit || pending}
				/>
			</div>
		</div>
	);
}

function GroupProgressTable({
	draftRooms,
	canEdit,
	pending,
	expandedRoomIds,
	onRoomToggle,
	onCableProgressChange,
}: {
	draftRooms: DraftRoom[];
	canEdit: boolean;
	pending: boolean;
	expandedRoomIds: Set<string>;
	onRoomToggle: (roomId: string) => void;
	onCableProgressChange: (roomId: string, cableId: string, progress: number) => void;
}) {
	return (
		<Table>
			<TableHeader className="hidden sm:table-header-group">
				<TableRow>
					<TableHead>Помещение</TableHead>
					<TableHead>Длина, общая</TableHead>
					<TableHead>Кол-во ниток</TableHead>
					<TableHead>Кабелей</TableHead>
					<TableHead className="sticky right-0 bg-background">Прогресс</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody className="block space-y-3 sm:table-row-group sm:space-y-0">
				{draftRooms.map((room) => {
					const roomProgress = getRoomProgress(room);
					const isExpanded = expandedRoomIds.has(room.id);

					return (
						<Fragment key={room.id}>
							<TableRow className="block rounded-lg border sm:table-row sm:rounded-none sm:border-x-0">
								<TableCell className="px-3 py-2 font-medium sm:table-cell sm:p-2" data-label="Помещение">
									<button
										type="button"
										onClick={() => onRoomToggle(room.id)}
										className="flex w-full items-center justify-between gap-3 text-left">
										<span className="flex min-w-0 items-center gap-2">
											<span className="rounded-md border bg-muted/40 p-1 text-muted-foreground">
												{isExpanded ? (
													<ChevronDownIcon className="size-4" />
												) : (
													<ChevronRightIcon className="size-4" />
												)}
											</span>
											<span className="truncate">{room.roomName}</span>
										</span>
										<Badge variant="secondary" className="shrink-0 sm:hidden">
											{roomProgress}%
										</Badge>
									</button>
								</TableCell>
								<TableCell
									className="flex items-start justify-between gap-4 whitespace-normal px-3 py-2 before:text-xs before:font-medium before:text-muted-foreground before:content-[attr(data-label)] sm:table-cell sm:p-2 sm:before:hidden"
									data-label="Длина, общая">
									<span className="text-right sm:text-left">{Math.round(room.totalLength)} м</span>
								</TableCell>
								<TableCell
									className="flex items-start justify-between gap-4 whitespace-normal px-3 py-2 before:text-xs before:font-medium before:text-muted-foreground before:content-[attr(data-label)] sm:table-cell sm:p-2 sm:before:hidden"
									data-label="Кол-во ниток">
									<span className="text-right sm:text-left">{room.threadCount}</span>
								</TableCell>
								<TableCell
									className="flex items-start justify-between gap-4 whitespace-normal px-3 py-2 before:text-xs before:font-medium before:text-muted-foreground before:content-[attr(data-label)] sm:table-cell sm:p-2 sm:before:hidden"
									data-label="Кабелей">
									<span className="text-right sm:text-left">{room.cables.length}</span>
								</TableCell>
								<TableCell
									className="whitespace-normal px-3 py-3 before:mb-2 before:block before:text-xs before:font-medium before:text-muted-foreground before:content-[attr(data-label)] sm:sticky sm:right-0 sm:table-cell sm:bg-background sm:p-2 sm:before:hidden"
									data-label="Прогресс">
									<div className="flex flex-wrap items-center justify-between gap-2 sm:min-w-52">
										<Badge variant="outline">{roomProgress}%</Badge>
										<span className="text-xs text-muted-foreground">
											Среднее по {room.cables.length} кабелям
										</span>
									</div>
								</TableCell>
							</TableRow>
							{isExpanded ? (
								<TableRow className="block border-0 sm:table-row">
									<TableCell colSpan={5} className="px-0 pt-0 pb-3 sm:p-3">
										<div className="mx-3 grid gap-2 rounded-lg border bg-muted/20 p-3 sm:mx-0">
											{room.cables.length > 0 ? (
												room.cables.map((cable) => (
													<CableProgressEditor
														key={cable.id}
														roomId={room.id}
														cable={cable}
														canEdit={canEdit}
														pending={pending}
														onProgressChange={onCableProgressChange}
													/>
												))
											) : (
												<div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
													Для этого помещения кабели не найдены.
												</div>
											)}
										</div>
									</TableCell>
								</TableRow>
							) : null}
						</Fragment>
					);
				})}
			</TableBody>
		</Table>
	);
}

export const GroupProgressSheet = memo(function GroupProgressSheet({
	group,
	canEdit,
	variant = "default",
	align = "left",
	className,
	onOverlayOpenChange,
}: {
	group: GraphGroupView;
	canEdit: boolean;
	variant?: "default" | "map";
	align?: "left" | "right";
	className?: string;
	onOverlayOpenChange?: (overlayId: string, open: boolean) => void;
}) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const [expandedRoomIds, setExpandedRoomIds] = useState<Set<string>>(() => new Set());
	const { draftRooms, effectiveDate, setEffectiveDate, changedCables, isDirty, updateCableProgress, reset } =
		useGroupProgressDraft(group, open);

	const hasRooms = group.primaryRooms.length > 0;
	const draftAverageProgress = useMemo(() => getAverageProgress(draftRooms), [draftRooms]);

	useEffect(() => {
		onOverlayOpenChange?.(`sheet:${group.id}`, open || confirmDiscardOpen);

		return () => onOverlayOpenChange?.(`sheet:${group.id}`, false);
	}, [confirmDiscardOpen, group.id, onOverlayOpenChange, open]);

	useEffect(() => {
		if (!open) {
			setExpandedRoomIds(new Set());
		}
	}, [open]);

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen && isDirty) {
			setConfirmDiscardOpen(true);
			return;
		}

		setOpen(nextOpen);
	}

	function handleRoomToggle(roomId: string) {
		setExpandedRoomIds((current) => {
			const next = new Set(current);

			if (next.has(roomId)) {
				next.delete(roomId);
			} else {
				next.add(roomId);
			}

			return next;
		});
	}

	async function handleSave() {
		if (!canEdit || changedCables.length === 0) return;

		setPending(true);

		try {
			await saveCableProgress({
				data: {
					groupId: group.id,
					effectiveDate,
					cables: changedCables,
				},
			});
			await router.invalidate();
			toast.success("Прогресс по кабелям сохранён.");
			setOpen(false);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось сохранить изменения по кабелям.");
		} finally {
			setPending(false);
		}
	}

	return (
		<>
			<Sheet open={open} onOpenChange={handleOpenChange}>
				<GroupProgressTrigger
					group={group}
					variant={variant}
					align={align}
					className={className}
					hasRooms={hasRooms}
					onOpen={() => setOpen(true)}
				/>

				<SheetContent
					side="bottom"
					className="max-h-[85vh] w-full rounded-t-[28px] border-x border-t pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:max-w-none">
					<SheetHeader>
						<SheetTitle>Помещения уровня {group.level}</SheetTitle>
						<SheetDescription>
							{group.graphSide === "dirty" ? "Левая часть графа" : "Правая часть графа"}
							{" · "}
							{group.sourceZone || "Без зоны"}
						</SheetDescription>
					</SheetHeader>

					<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-2">
						<div className="flex flex-wrap items-center gap-2">
							<Badge variant="outline">Кабелей: {group.cableCount}</Badge>
							<Badge variant="outline">Ниток: {group.threadCount}</Badge>
							<Badge variant="outline">Длина: {Math.round(group.totalLength)} м</Badge>
							<Badge variant="secondary">Средний прогресс: {draftAverageProgress}%</Badge>
						</div>

						<GroupProgressControls
							canEdit={canEdit}
							pending={pending}
							isDirty={isDirty}
							effectiveDate={effectiveDate}
							onSave={() => void handleSave()}
							onReset={reset}
							onDateChange={setEffectiveDate}
						/>

						<Separator />

						<GroupProgressTable
							draftRooms={draftRooms}
							canEdit={canEdit}
							pending={pending}
							expandedRoomIds={expandedRoomIds}
							onRoomToggle={handleRoomToggle}
							onCableProgressChange={updateCableProgress}
						/>
					</div>
				</SheetContent>
			</Sheet>

			<AlertDialog open={confirmDiscardOpen} onOpenChange={setConfirmDiscardOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogMedia>
							<TriangleAlertIcon />
						</AlertDialogMedia>
						<AlertDialogTitle>Отменить несохранённые изменения?</AlertDialogTitle>
						<AlertDialogDescription>
							Все изменения прогресса по кабелям будут сброшены.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Продолжить редактирование</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								setConfirmDiscardOpen(false);
								setOpen(false);
							}}>
							Сбросить
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
});

GroupProgressSheet.displayName = "GroupProgressSheet";
