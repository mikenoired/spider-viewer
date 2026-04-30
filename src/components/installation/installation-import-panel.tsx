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
	snapshot,
	onUpload,
}: {
	canEdit: boolean;
	importing: boolean;
	snapshot: InstallationSnapshotView | null;
	onUpload: (file: File) => Promise<void>;
}) {
	const [file, setFile] = useState<File | null>(null);

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

	return (
		<Card>
			<CardHeader>
				<CardTitle>Данные монтажа</CardTitle>
				<CardDescription>Импорт таблицы с колонками группы KKS, названия KKS и состояния.</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
				<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="installation-file">Файл монтажа</FieldLabel>
							<Input
								id="installation-file"
								type="file"
								accept=".ods,.xlsx,.xls"
								disabled={!canEdit || importing}
								onChange={(event) => setFile(event.target.files?.[0] ?? null)}
							/>
							<FieldDescription>
								Первый лист: группа KKS, KKS, готово. Повторный импорт заменит активный snapshot.
							</FieldDescription>
						</Field>
					</FieldGroup>
					<Button type="submit" disabled={!canEdit || !file || importing}>
						{importing ? (
							<LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
						) : (
							<UploadIcon data-icon="inline-start" />
						)}
						Импортировать
					</Button>
				</form>
				<SnapshotSummary snapshot={snapshot} />
			</CardContent>
		</Card>
	);
}

function SnapshotSummary({ snapshot }: { snapshot: InstallationSnapshotView | null }) {
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
				<SummaryItem label="KKS" value={String(snapshot.kksCount)} />
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
