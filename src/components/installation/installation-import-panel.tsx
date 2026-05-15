"use client";

import { FileSpreadsheetIcon, LoaderCircleIcon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { SnapshotSummaryView } from "@/lib/cable-map/shared";

export function InstallationImportPanel({
	canEdit,
	importing,
	importingProgress,
	snapshot,
	onUpload,
	onProgressUpload,
}: {
	canEdit: boolean;
	importing: boolean;
	importingProgress: boolean;
	snapshot: SnapshotSummaryView | null;
	onUpload: (file: File) => Promise<void>;
	onProgressUpload: (files: File[]) => Promise<void>;
}) {
	const [file, setFile] = useState<File | null>(null);
	const [progressFiles, setProgressFiles] = useState<File[]>([]);

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (!file) {
			toast.error("Выберите файл `.ods`, `.xlsx` или `.xls`.");
			return;
		}

		await onUpload(file);
		setFile(null);
		event.currentTarget.reset();
	}

	async function handleProgressSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (progressFiles.length === 0) {
			toast.error("Выберите журналы готовности `.xlsx`.");
			return;
		}

		await onProgressUpload(progressFiles);
		setProgressFiles([]);
		event.currentTarget.reset();
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Данные монтажа</CardTitle>
				<CardDescription>
					Импорт workbook УСБТ строит карту монтажа в том же формате, что и карта демонтажа.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
				<div className="grid gap-4">
					<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor="installation-file">Файл карты монтажа</FieldLabel>
								<Input
									id="installation-file"
									type="file"
									accept=".ods,.xlsx,.xls"
									disabled={!canEdit || importing}
									onChange={(event) => setFile(event.target.files?.[0] ?? null)}
								/>
								<FieldDescription>
									Ожидается workbook с листом `УСБТ`. Повторный импорт заменит активную карту монтажа.
								</FieldDescription>
							</Field>
						</FieldGroup>
						<Button type="submit" disabled={!canEdit || !file || importing}>
							{importing ? (
								<LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
							) : (
								<UploadIcon data-icon="inline-start" />
							)}
							Импортировать карту
						</Button>
					</form>
					<form
						className="flex flex-col gap-4 rounded-xl border bg-muted/20 p-3"
						onSubmit={handleProgressSubmit}>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor="installation-progress-files">Файлы выполненных работ</FieldLabel>
								<Input
									id="installation-progress-files"
									type="file"
									accept=".ods,.xlsx,.xls"
									multiple
									disabled={!canEdit || importingProgress || !snapshot}
									onChange={(event) => setProgressFiles(Array.from(event.target.files ?? []))}
								/>
								<FieldDescription>
									Поддержаны журналы готовности ИК и ДУ. Найденные кабели отмечаются как 100% и попадают в
									отчёт.
								</FieldDescription>
							</Field>
						</FieldGroup>
						<Button
							type="submit"
							variant="secondary"
							disabled={!canEdit || !snapshot || progressFiles.length === 0 || importingProgress}>
							{importingProgress ? (
								<LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
							) : (
								<UploadIcon data-icon="inline-start" />
							)}
							Загрузить выполненные работы
						</Button>
					</form>
				</div>
				<SnapshotSummary snapshot={snapshot} />
			</CardContent>
		</Card>
	);
}

function SnapshotSummary({ snapshot }: { snapshot: SnapshotSummaryView | null }) {
	if (!snapshot) {
		return (
			<div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
				Активные данные монтажа пока не загружены.
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4">
			<div className="flex items-start gap-3">
				<div className="rounded-md border bg-background p-2 text-muted-foreground">
					<FileSpreadsheetIcon />
				</div>
				<div className="min-w-0">
					<div className="truncate text-sm font-medium">{snapshot.fileName}</div>
					<div className="text-sm text-muted-foreground">{snapshot.fileType.toUpperCase()}</div>
				</div>
			</div>
			<div className="grid grid-cols-2 gap-2 text-sm">
				<SummaryItem label="Групп" value={String(snapshot.groupCount)} />
				<SummaryItem label="Кабелей" value={String(snapshot.rowCount)} />
				<SummaryItem label="Уровней" value={String(snapshot.levelCount)} />
				<SummaryItem label="Прогресс" value={`${snapshot.averageProgress}%`} />
			</div>
		</div>
	);
}

function SummaryItem({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-md border bg-background px-3 py-2">
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className="text-base font-medium">{value}</div>
		</div>
	);
}
