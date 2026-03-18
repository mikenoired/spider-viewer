"use client";

import { useRouter } from "@tanstack/react-router";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
	CalendarIcon,
	LoaderCircleIcon,
	RotateCcwIcon,
	SaveIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { saveRoomProgress } from "@/lib/cable-map/functions";
import type { GraphGroupView } from "@/lib/cable-map/shared";
import { cn } from "@/lib/utils";

type DraftRoom = {
	id: string;
	roomName: string;
	cableCount: number;
	threadCount: number;
	totalLength: number;
	progress: number;
};

function getTodayInMoscow() {
	return new Intl.DateTimeFormat("sv-SE", {
		timeZone: "Europe/Moscow",
	}).format(new Date());
}

function parseIsoDate(value: string | null) {
	if (!value) {
		return undefined;
	}

	const date = new Date(`${value}T12:00:00+03:00`);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

function createDraftRooms(group: GraphGroupView): DraftRoom[] {
	return group.primaryRooms.map((room) => ({
		id: room.id,
		roomName: room.roomName,
		cableCount: room.cableCount,
		threadCount: room.threadCount,
		totalLength: room.totalLength,
		progress: room.progress,
	}));
}

function clampProgress(value: number) {
	if (Number.isNaN(value)) {
		return 0;
	}

	return Math.min(100, Math.max(0, Math.round(value)));
}

export function GroupProgressSheet({
	group,
	canEdit,
	variant = "default",
	className,
}: {
	group: GraphGroupView;
	canEdit: boolean;
	variant?: "default" | "pdf";
	className?: string;
}) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const [draftRooms, setDraftRooms] = useState<DraftRoom[]>(() =>
		createDraftRooms(group),
	);
	const [effectiveDate, setEffectiveDate] = useState<string | null>(
		group.primaryRooms[0]?.effectiveDate ?? getTodayInMoscow(),
	);

	useEffect(() => {
		if (!open) {
			setDraftRooms(createDraftRooms(group));
			setEffectiveDate(
				group.primaryRooms[0]?.effectiveDate ?? getTodayInMoscow(),
			);
		}
	}, [group, open]);

	const hasRooms = group.primaryRooms.length > 0;
	const changedRooms = useMemo(
		() =>
			draftRooms.flatMap((room) => {
				const source = group.primaryRooms.find(
					(candidate) => candidate.id === room.id,
				);

				if (!source || source.progress === room.progress) {
					return [];
				}

				return [
					{
						roomId: room.id,
						progress: room.progress,
					},
				];
			}),
		[draftRooms, group.primaryRooms],
	);
	const isDirty = changedRooms.length > 0;

	function updateRoomProgress(roomId: string, progress: number) {
		setDraftRooms((current) =>
			current.map((room) =>
				room.id === roomId
					? {
							...room,
							progress: clampProgress(progress),
						}
					: room,
			),
		);
	}

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen && isDirty) {
			setConfirmDiscardOpen(true);
			return;
		}

		setOpen(nextOpen);
	}

	async function handleSave() {
		if (!canEdit || changedRooms.length === 0) {
			return;
		}

		setPending(true);

		try {
			await saveRoomProgress({
				data: {
					groupId: group.id,
					effectiveDate,
					rooms: changedRooms,
				},
			});
			await router.invalidate();
			toast.success("Прогресс по помещениям сохранён.");
			setOpen(false);
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Не удалось сохранить изменения по помещениям.",
			);
		} finally {
			setPending(false);
		}
	}

	return (
		<>
			<Sheet open={open} onOpenChange={handleOpenChange}>
				<button
					type="button"
					onClick={() => setOpen(true)}
					className={cn(
						variant === "pdf"
							? "relative flex h-full w-full flex-col rounded-[8px] border border-[#d2b55a] bg-[#f7db76] px-3 py-2 text-left text-zinc-900 shadow-sm transition hover:bg-[#f2d169] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#9b7c19] dark:bg-[#d7b652] dark:text-[#1f1400]"
							: "flex min-h-40 w-full flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-left transition hover:border-primary/40 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60",
						!hasRooms && "pointer-events-none",
						className,
					)}
					disabled={!hasRooms}
				>
					{variant === "pdf" ? (
						<>
							<div className="absolute right-2 top-2 rounded-[4px] border border-white/70 bg-white/85 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700 shadow-sm dark:border-black/10 dark:bg-[#fff4cf] dark:text-[#3d2b00]">
								{group.averageProgress}%
							</div>
							<div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-700/75">
								Основной блок
							</div>
							<div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] font-semibold leading-4">
								{group.primaryRooms.slice(0, 10).map((room) => (
									<div key={room.id} className="truncate">
										{room.roomName}
									</div>
								))}
							</div>
							{group.primaryRooms.length > 10 ? (
								<div className="mt-auto pt-2 text-[10px] font-medium text-zinc-700/80">
									+{group.primaryRooms.length - 10}
								</div>
							) : null}
						</>
					) : (
						<>
							<div className="flex items-start justify-between gap-3">
								<div className="flex flex-col gap-1">
									<div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
										Основной блок помещений
									</div>
									<div className="text-sm font-medium">
										{group.primaryRooms.length} помещений
									</div>
								</div>
								<Badge variant="secondary">{group.averageProgress}%</Badge>
							</div>
							<div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
								{group.primaryRooms.slice(0, 8).map((room) => (
									<div
										key={room.id}
										className="truncate rounded-lg bg-muted/60 px-2 py-1.5"
									>
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

				<SheetContent className="w-full sm:max-w-4xl">
					<SheetHeader>
						<SheetTitle>Помещения уровня {group.level}</SheetTitle>
						<SheetDescription>
							{group.graphSide === "dirty"
								? "Левая часть графа"
								: "Правая часть графа"}
							{" · "}
							{group.sourceZone || "Без зоны"}
						</SheetDescription>
					</SheetHeader>

					<div className="flex flex-col gap-4 px-4 pb-4">
						<div className="flex flex-wrap items-center gap-2">
							<Badge variant="outline">Кабелей: {group.cableCount}</Badge>
							<Badge variant="outline">Ниток: {group.threadCount}</Badge>
							<Badge variant="outline">
								Длина: {Math.round(group.totalLength)} м
							</Badge>
							<Badge variant="secondary">
								Средний прогресс: {group.averageProgress}%
							</Badge>
						</div>

						{canEdit ? (
							<div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-muted/30 p-3">
								<Button
									type="button"
									onClick={handleSave}
									disabled={!isDirty || pending}
								>
									{pending ? (
										<LoaderCircleIcon
											data-icon="inline-start"
											className="animate-spin"
										/>
									) : (
										<SaveIcon data-icon="inline-start" />
									)}
									Сохранить
								</Button>

								<Popover>
									<PopoverTrigger asChild>
										<Button type="button" variant="outline">
											<CalendarIcon data-icon="inline-start" />
											{effectiveDate
												? format(
														parseIsoDate(effectiveDate) ?? new Date(),
														"d MMMM yyyy",
														{ locale: ru },
													)
												: "Выбрать дату"}
										</Button>
									</PopoverTrigger>
									<PopoverContent align="start" className="w-auto">
										<PopoverHeader>
											<PopoverTitle>Дата изменения</PopoverTitle>
										</PopoverHeader>
										<Calendar
											mode="single"
											selected={parseIsoDate(effectiveDate)}
											onSelect={(value) =>
												setEffectiveDate(
													value
														? format(value, "yyyy-MM-dd")
														: getTodayInMoscow(),
												)
											}
										/>
									</PopoverContent>
								</Popover>

								<Button
									type="button"
									variant="ghost"
									onClick={() => {
										setDraftRooms(createDraftRooms(group));
										setEffectiveDate(
											group.primaryRooms[0]?.effectiveDate ??
												getTodayInMoscow(),
										);
									}}
									disabled={!isDirty || pending}
								>
									<RotateCcwIcon data-icon="inline-start" />
									Отменить изменения
								</Button>
							</div>
						) : (
							<div className="rounded-2xl border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
								Режим просмотра: редактирование доступно только админам и
								супер-админам.
							</div>
						)}

						<Separator />

						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Помещение</TableHead>
									<TableHead>Длина, общая</TableHead>
									<TableHead>Кол-во ниток</TableHead>
									<TableHead>Кабелей</TableHead>
									<TableHead className="sticky right-0 bg-background">
										Прогресс
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{draftRooms.map((room) => (
									<TableRow key={room.id}>
										<TableCell className="font-medium">
											{room.roomName}
										</TableCell>
										<TableCell>{Math.round(room.totalLength)} м</TableCell>
										<TableCell>{room.threadCount}</TableCell>
										<TableCell>{room.cableCount}</TableCell>
										<TableCell className="sticky right-0 bg-background">
											<div className="grid min-w-64 grid-cols-[1fr_84px] items-center gap-3">
												<Slider
													value={[room.progress]}
													onValueChange={(value) =>
														updateRoomProgress(room.id, value[0] ?? 0)
													}
													disabled={!canEdit || pending}
													max={100}
													min={0}
													step={1}
												/>
												<Input
													type="number"
													min={0}
													max={100}
													value={room.progress}
													onChange={(event) =>
														updateRoomProgress(
															room.id,
															Number(event.target.value),
														)
													}
													disabled={!canEdit || pending}
												/>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</SheetContent>
			</Sheet>

			<AlertDialog
				open={confirmDiscardOpen}
				onOpenChange={setConfirmDiscardOpen}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogMedia>
							<TriangleAlertIcon />
						</AlertDialogMedia>
						<AlertDialogTitle>
							Отменить несохранённые изменения?
						</AlertDialogTitle>
						<AlertDialogDescription>
							Все изменения прогресса по помещениям будут сброшены.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Продолжить редактирование</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								setConfirmDiscardOpen(false);
								setOpen(false);
							}}
						>
							Сбросить
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
