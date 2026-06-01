"use client";

import { FileSpreadsheetIcon, LoaderCircleIcon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { InstallationSnapshotView } from "@/lib/installation/shared";

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
	snapshot: InstallationSnapshotView | null;
	onUpload: (file: File, baseFile: File | null) => Promise<void>;
	onProgressUpload: (files: File[]) => Promise<void>;
}) {
	const [file, setFile] = useState<File | null>(null);
	const [baseFile, setBaseFile] = useState<File | null>(null);
	const [progressFiles, setProgressFiles] = useState<File[]>([]);

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (!file) {
			toast.error("Выберите файл `.ods`, `.xlsx` или `.xls`.");
			return;
		}

		await onUpload(file, baseFile);
		setFile(null);
		setBaseFile(null);
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
					Импорт первоочередных карточек собирает группы KKS и переносит готовность из базы кабелей.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
				<div className="grid gap-4">
					<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor="installation-file">Файл первоочередных карточек</FieldLabel>
								<Input
									id="installation-file"
									type="file"
									accept=".ods,.xlsx,.xls"
									disabled={!canEdit || importing}
									onChange={(event) => setFile(event.target.files?.[0] ?? null)}
								/>
								<FieldDescription>
									Ожидается workbook с группами «Арматура», «ИК» и другими карточками. Повторный импорт
									заменит активный набор данных монтажа.
								</FieldDescription>
							</Field>
							<Field>
								<FieldLabel htmlFor="installation-base-file">База кабелей для контроля</FieldLabel>
								<Input
									id="installation-base-file"
									type="file"
									accept=".ods,.xlsx,.xls"
									disabled={!canEdit || importing}
									onChange={(event) => setBaseFile(event.target.files?.[0] ?? null)}
								/>
								<FieldDescription>
									Необязательный файл. Если в базе кабель отмечен как проложенный, он сразу попадёт в
									«Готово».
								</FieldDescription>
							</Field>
						</FieldGroup>
						<Button type="submit" disabled={!canEdit || !file || importing}>
							{importing ? (
								<LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
							) : (
								<UploadIcon data-icon="inline-start" />
							)}
							Импортировать монтаж
						</Button>
					</form>
					<form className="flex flex-col gap-4 border-t pt-4" onSubmit={handleProgressSubmit}>
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
									Поддержаны журналы готовности ИК и ДУ. Найденные кабели отмечаются готовыми в доске.
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

function SnapshotSummary({ snapshot }: { snapshot: InstallationSnapshotView | null }) {
	if (!snapshot) {
		return (
			<div className="border-t px-1 py-4 text-sm text-muted-foreground lg:border-l lg:border-t-0 lg:pl-4">
				Активные данные монтажа пока не загружены.
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3 border-t pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
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
				<SummaryItem label="KKS" value={String(snapshot.kksCount)} />
				<SummaryItem label="Кабелей" value={String(snapshot.cableCount)} />
				<SummaryItem label="Готово из базы" value={String(snapshot.baseDoneCount)} />
			</div>
		</div>
	);
}

function SummaryItem({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className="text-base font-medium">{value}</div>
		</div>
	);
}
