"use client";

import { useNavigate, useRouter } from "@tanstack/react-router";
import { FileSpreadsheetIcon, LoaderCircleIcon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { uploadWorkbook } from "@/lib/cable-map/functions";
import type { SnapshotSummaryView } from "@/lib/cable-map/shared";

export function SnapshotImportForm({ snapshot }: { snapshot: SnapshotSummaryView | null }) {
	const router = useRouter();
	const navigate = useNavigate();
	const [pending, setPending] = useState(false);
	const [file, setFile] = useState<File | null>(null);

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (!file) {
			toast.error("Выберите файл `.ods`, `.xlsx` или `.xls`.");
			return;
		}

		setPending(true);

		try {
			const formData = new FormData();
			formData.set("file", file);

			const result = await uploadWorkbook({
				data: formData,
			});

			await router.invalidate();
			toast.success(`Импорт завершён: ${result.rowCount} строк, ${result.groupCount} групп.`);
			await navigate({ to: "/app" });
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось выполнить импорт файла.");
		} finally {
			setPending(false);
		}
	}

	return (
		<div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] px-4 pt-4">
			<Card>
				<CardHeader>
					<CardTitle>Импорт графа из workbook</CardTitle>
					<CardDescription>
						Поддерживаются файлы Excel и LibreOffice Calc. В обработку идёт только лист {'"Общ"'}.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form className="flex flex-col gap-5" onSubmit={handleSubmit}>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor="workbook-file">Файл графа</FieldLabel>
								<Input
									id="workbook-file"
									type="file"
									accept=".ods,.xlsx,.xls"
									onChange={(event) => setFile(event.target.files?.[0] ?? null)}
								/>
								<FieldDescription>
									После повторного импорта активный набор данных будет заменён новым. Поддерживаются
									корректные `.ods`, `.xlsx`, `.xls` файлы до 15 МБ.
								</FieldDescription>
							</Field>
						</FieldGroup>

						<Button type="submit" disabled={!file || pending}>
							{pending ? (
								<LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
							) : (
								<UploadIcon data-icon="inline-start" />
							)}
							Импортировать файл
						</Button>
					</form>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Текущий активный набор данных</CardTitle>
					<CardDescription>
						Этот блок помогает быстро сверить, что именно сейчас отображается на карте.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{snapshot ? (
						<>
							<div className="rounded-lg border bg-muted/20 p-4">
								<div className="flex items-start gap-3">
									<div className="rounded-md border bg-background p-2 text-muted-foreground">
										<FileSpreadsheetIcon />
									</div>
									<div className="flex flex-col gap-1">
										<div className="text-sm font-medium">{snapshot.fileName}</div>
										<div className="text-sm text-muted-foreground">
											Формат: {snapshot.fileType.toUpperCase()}
										</div>
									</div>
								</div>
							</div>
							<div className="grid grid-cols-2 gap-3 text-sm">
								<InfoItem label="Строк" value={String(snapshot.rowCount)} />
								<InfoItem label="Уровней" value={String(snapshot.levelCount)} />
								<InfoItem label="Групп" value={String(snapshot.groupCount)} />
								<InfoItem label="Помещений" value={String(snapshot.roomCount)} />
							</div>
						</>
					) : (
						<div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
							Активный набор данных пока отсутствует.
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function InfoItem({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-lg border bg-background px-3 py-2">
			<div className="text-xs uppercase text-muted-foreground">{label}</div>
			<div className="mt-1 text-lg font-semibold">{value}</div>
		</div>
	);
}
