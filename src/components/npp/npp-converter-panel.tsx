"use client";

import { ArchiveIcon, FileOutputIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { convertNppToDocx } from "@/lib/cable-map/functions";
import { downloadResponseFile } from "@/lib/utils";

type DirectoryInput = HTMLInputElement & { webkitdirectory?: boolean };

export function NppConverterPanel() {
	const inputRef = useRef<DirectoryInput>(null);
	const [files, setFiles] = useState<File[]>([]);
	const [pending, setPending] = useState(false);

	useEffect(() => {
		if (inputRef.current) inputRef.current.webkitdirectory = true;
	}, []);

	async function convert() {
		if (files.length === 0) return;
		setPending(true);
		try {
			const formData = new FormData();
			for (const file of files) formData.append("files", file);
			formData.set(
				"paths",
				JSON.stringify(
					files.map((file) => file.webkitRelativePath.split("/").slice(1).join("/") || file.name)
				)
			);
			const response = await convertNppToDocx({ data: formData });
			await downloadResponseFile(response, "npp-docx-result.zip");
			toast.success("Обработка завершена. Архив DOCX загружен.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось обработать файлы NPP.");
		} finally {
			setPending(false);
		}
	}

	const svgCount = files.filter((file) => file.name.toLowerCase().endsWith(".svg")).length;
	const hasDatabaseFiles = ["PLS_ANA_CONF.dmp", "PLS_BIN_CONF.dmp"].every((name) =>
		files.some((file) => file.name === name)
	);

	return (
		<div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 pb-4">
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<FileOutputIcon className="size-5" />
						NPP → DOCX
					</CardTitle>
					<CardDescription>
						Встроенный обработчик из npp_to_docx: расставляет маркеры на SVG, сверяет KKS с PLS и формирует
						DOCX.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="npp-input-folder">Исходная папка NPP</FieldLabel>
							<input
								ref={inputRef}
								id="npp-input-folder"
								type="file"
								multiple
								className="block w-full text-sm"
								onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
							/>
							<FieldDescription>
								Выберите папку, содержащую <code>PLS_ANA_CONF.dmp</code>, <code>PLS_BIN_CONF.dmp</code> и
								каталог <code>svg</code>. Исходные файлы обрабатываются во временном изолированном каталоге и
								удаляются после выдачи результата.
							</FieldDescription>
						</Field>
					</FieldGroup>
					<div className="mt-5 grid gap-3 sm:grid-cols-3">
						<Stat label="Файлов выбрано" value={String(files.length)} />
						<Stat label="SVG" value={String(svgCount)} />
						<Stat label="PLS-базы" value={hasDatabaseFiles ? "Найдены" : "Не найдены"} />
					</div>
					<Button
						type="button"
						className="mt-5"
						disabled={pending || files.length === 0 || !hasDatabaseFiles || svgCount === 0}
						onClick={() => void convert()}>
						{pending ? <LoaderCircleIcon className="animate-spin" /> : <ArchiveIcon />}Сформировать архив DOCX
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-lg border bg-muted/20 p-3">
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className="mt-1 text-sm font-semibold">{value}</div>
		</div>
	);
}
