"use client";

import { useRouter } from "@tanstack/react-router";
import { FileSpreadsheetIcon, LoaderCircleIcon, StarIcon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { uploadPriorityRoomList } from "@/lib/cable-map/functions";
import type { PriorityRoomListView } from "@/lib/cable-map/shared";

export function PriorityRoomListsCard({
	canUpload,
	priorityLists,
	priorityRoomCount,
}: {
	canUpload: boolean;
	priorityLists: PriorityRoomListView[];
	priorityRoomCount: number;
}) {
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [authorName, setAuthorName] = useState("");
	const [file, setFile] = useState<File | null>(null);

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (!canUpload) {
			return;
		}

		if (!file) {
			toast.error("Выберите файл со списком приоритетных помещений.");
			return;
		}

		if (!authorName.trim()) {
			toast.error("Укажите автора списка.");
			return;
		}

		setPending(true);

		try {
			const formData = new FormData();
			formData.set("file", file);
			formData.set("author", authorName);

			const result = await uploadPriorityRoomList({
				data: formData,
			});

			await router.invalidate();
			toast.success(`Список "${result.authorName}" загружен: ${result.roomCount} помещений.`);
			setAuthorName("");
			setFile(null);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Не удалось загрузить список приоритетных помещений."
			);
		} finally {
			setPending(false);
		}
	}

	return (
		<Card>
			<CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<CardTitle className="flex items-center gap-2">
						<StarIcon className="size-4 text-amber-500" />
						Первоочередные помещения
					</CardTitle>
					<CardDescription>
						Загрузите Excel-список с названиями помещений. Комнаты будут подсвечены на карте монтажа и получат
						подпись автора.
					</CardDescription>
				</div>
				<div className="flex flex-wrap gap-2">
					<Badge variant="secondary">Списков: {priorityLists.length}</Badge>
					<Badge variant="outline">Помещений: {priorityRoomCount}</Badge>
				</div>
			</CardHeader>

			<CardContent className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
				{canUpload ? (
					<form className="grid gap-4 rounded-2xl border bg-muted/20 p-4" onSubmit={handleSubmit}>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor="priority-author">Автор списка</FieldLabel>
								<Input
									id="priority-author"
									value={authorName}
									onChange={(event) => setAuthorName(event.target.value)}
									placeholder="Например, Сидоров И.И."
								/>
							</Field>

							<Field>
								<FieldLabel htmlFor="priority-file">Файл списка</FieldLabel>
								<Input
									id="priority-file"
									type="file"
									accept=".ods,.xlsx,.xls"
									onChange={(event) => setFile(event.target.files?.[0] ?? null)}
								/>
								<FieldDescription>
									Берётся первый лист файла. В каждой строке должно быть одно название помещения.
								</FieldDescription>
							</Field>
						</FieldGroup>

						<Button type="submit" disabled={pending || !file || !authorName.trim()}>
							{pending ? (
								<LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
							) : (
								<UploadIcon data-icon="inline-start" />
							)}
							Загрузить список
						</Button>
					</form>
				) : (
					<div className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
						Загрузка доступна только супер-админу.
					</div>
				)}

				<div className="grid gap-3">
					{priorityLists.length > 0 ? (
						priorityLists.map((list) => (
							<div key={list.id} className="rounded-2xl border bg-background p-4">
								<div className="flex items-start gap-3">
									<div className="rounded-xl border bg-muted/30 p-2 text-muted-foreground">
										<FileSpreadsheetIcon className="size-4" />
									</div>
									<div className="min-w-0 flex-1 space-y-1">
										<div className="flex flex-wrap items-center gap-2">
											<div className="text-sm font-semibold">{list.authorName}</div>
											<Badge variant="outline">{list.roomCount} помещений</Badge>
										</div>
										<div className="truncate text-sm text-muted-foreground">{list.fileName}</div>
										<div className="text-xs text-muted-foreground">Загрузил: {list.importedByLogin}</div>
									</div>
								</div>
							</div>
						))
					) : (
						<div className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
							Списки приоритетных помещений пока не загружены.
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
