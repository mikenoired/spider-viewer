"use client";

import { useRouter } from "@tanstack/react-router";
import { LoaderCircleIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createManualRoom, deleteManualRoom } from "@/lib/cable-map/functions";
import type {
	GraphGroupView,
	GraphManualRoomView,
} from "@/lib/cable-map/shared";
import { cn } from "@/lib/utils";

export function ManualRoomBlock({
	group,
	canManage,
	className,
}: {
	group: GraphGroupView;
	canManage: boolean;
	className?: string;
}) {
	const router = useRouter();
	const [addDialogOpen, setAddDialogOpen] = useState(false);
	const [pendingAction, setPendingAction] = useState<
		"create" | "delete" | null
	>(null);
	const [draftRoomName, setDraftRoomName] = useState("");
	const [deleteCandidate, setDeleteCandidate] =
		useState<GraphManualRoomView | null>(null);
	const hasRooms = group.manualRooms.length > 0;
	const canSave = draftRoomName.trim().length > 0 && pendingAction !== "create";

	useEffect(() => {
		if (!addDialogOpen) {
			setDraftRoomName("");
		}
	}, [addDialogOpen]);

	async function handleCreateRoom() {
		if (!canManage || !draftRoomName.trim()) {
			return;
		}

		setPendingAction("create");

		try {
			await createManualRoom({
				data: {
					groupId: group.id,
					roomName: draftRoomName,
				},
			});
			toast.success("Помещение добавлено в ручной жёлтый блок.");
			setAddDialogOpen(false);
			await router.invalidate();
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Не удалось добавить ручное помещение.",
			);
		} finally {
			setPendingAction(null);
		}
	}

	async function handleDeleteRoom() {
		if (!canManage || !deleteCandidate) {
			return;
		}

		setPendingAction("delete");

		try {
			await deleteManualRoom({
				data: {
					roomId: deleteCandidate.id,
				},
			});
			toast.success("Ручное помещение удалено.");
			setDeleteCandidate(null);
			await router.invalidate();
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Не удалось удалить ручное помещение.",
			);
		} finally {
			setPendingAction(null);
		}
	}

	return (
		<>
			<div className={cn("flex h-full items-center justify-center", className)}>
				{hasRooms ? (
					<div className="flex w-full flex-col gap-2 rounded-[8px] border border-[#d2b55a] bg-amber-200 dark:bg-amber-700 px-2 py-2 text-amber-950 dark:text-amber-100 shadow-sm">
						<div className="flex flex-col gap-1">
							{group.manualRooms.map((room) => (
								<button
									key={room.id}
									type="button"
									onClick={() => {
										if (!canManage) {
											return;
										}

										setDeleteCandidate(room);
									}}
									className={cn(
										"min-w-0 rounded-[6px] border border-[#b89124]/40 bg-white/40 px-2 py-1.5 text-left text-xs font-semibold leading-4 wrap-break-word transition",
										canManage
											? "cursor-pointer hover:bg-white/60"
											: "cursor-default",
									)}
								>
									{room.roomName}
								</button>
							))}
						</div>

						{canManage ? (
							<Button
								type="button"
								onClick={() => setAddDialogOpen(true)}
								variant="outline"
								className="h-10 border-dashed border-amber-800 bg-white/20 text-amber-950 hover:bg-white/35 dark:border-amber-200 dark:bg-transparent dark:text-amber-100 dark:hover:bg-white/10"
							>
								<PlusIcon data-icon="inline-start" />
							</Button>
						) : null}
					</div>
				) : (
					<div className="flex h-full min-h-35 w-full flex-col items-center justify-center gap-3 rounded-[10px] border-2 border-dashed border-[#c6a643] bg-amber-200/50 px-3 py-4 text-center text-amber-950 shadow-sm dark:bg-amber-600/50 dark:text-amber-100">
						{canManage ? (
							<Button
								type="button"
								onClick={() => setAddDialogOpen(true)}
								variant="outline"
								className="h-10 border-dashed border-amber-800 bg-white/20 text-amber-950 hover:bg-white/35 dark:border-amber-200 dark:bg-transparent dark:text-amber-100 dark:hover:bg-white/10"
							>
								<PlusIcon data-icon="inline-start" />
							</Button>
						) : null}
					</div>
				)}
			</div>

			<Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Новое ручное помещение</DialogTitle>
						<DialogDescription>
							Помещение будет привязано к зоне {group.sourceZone || "Без зоны"}{" "}
							и отметке {group.level}.
						</DialogDescription>
					</DialogHeader>

					<div className="flex flex-col gap-3">
						<Input
							autoFocus
							placeholder="Например, АВ1107/1"
							value={draftRoomName}
							onChange={(event) => setDraftRoomName(event.target.value)}
							disabled={pendingAction === "create"}
						/>
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setAddDialogOpen(false)}
							disabled={pendingAction === "create"}
						>
							Отмена
						</Button>
						<Button
							type="button"
							onClick={handleCreateRoom}
							disabled={!canSave}
						>
							{pendingAction === "create" ? (
								<LoaderCircleIcon
									data-icon="inline-start"
									className="animate-spin"
								/>
							) : (
								<PlusIcon data-icon="inline-start" />
							)}
							Сохранить
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={deleteCandidate !== null}
				onOpenChange={(open) => {
					if (!open && pendingAction !== "delete") {
						setDeleteCandidate(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogMedia>
							<Trash2Icon />
						</AlertDialogMedia>
						<AlertDialogTitle>Удалить ручное помещение?</AlertDialogTitle>
						<AlertDialogDescription>
							Помещение {deleteCandidate?.roomName ?? ""} будет удалено из
							жёлтого блока для зоны {group.sourceZone || "Без зоны"} и отметки{" "}
							{group.level}.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={pendingAction === "delete"}>
							Отмена
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteRoom}
							disabled={pendingAction === "delete"}
						>
							{pendingAction === "delete" ? (
								<LoaderCircleIcon
									data-icon="inline-start"
									className="animate-spin"
								/>
							) : (
								<Trash2Icon data-icon="inline-start" />
							)}
							Удалить
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
