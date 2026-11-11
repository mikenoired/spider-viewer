"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DocumentPageResult } from "@/lib/cable-map/document-ocr";
import { type DocumentCableRow, documentCableRowSchema } from "@/lib/cable-map/task-documents";

const columns = {
	cableNumber: "№ кабеля",
	cableLabel: "Маркировка / KKS",
	fromRoom: "Откуда (помещение)",
	toRoom: "Куда (помещение)",
	cableType: "Марка кабеля",
	section: "Сечение",
	length: "Длина, м",
	route: "Трассировка",
	drum: "Барабан",
} as const;

export function DocumentRecognition({
	file,
	onRows,
	disabled,
	onBusyChange,
}: {
	file: File;
	onRows: (rows: DocumentCableRow[] | null) => void;
	disabled: boolean;
	onBusyChange: (busy: boolean) => void;
}) {
	const [pages, setPages] = useState<DocumentPageResult[]>([]);
	const [rows, setRows] = useState<DocumentCableRow[]>([]);
	const [message, setMessage] = useState("");
	const [running, setRunning] = useState(false);
	const [rotation, setRotation] = useState("auto");
	const controller = useRef<AbortController | null>(null);
	useEffect(() => () => controller.current?.abort(), []);
	async function recognize() {
		const abort = new AbortController();
		controller.current = abort;
		setRunning(true);
		onBusyChange(true);
		setPages([]);
		setRows([]);
		onRows(null);
		const collected: DocumentCableRow[] = [];
		try {
			const { recognizeTaskDocument } = await import("@/lib/cable-map/document-ocr");
			await recognizeTaskDocument(
				file,
				(page) => {
					if (abort.signal.aborted) return;
					setPages((previous) => [...previous, page]);
					collected.push(...page.rows);
					setRows([...collected]);
				},
				(text) => {
					if (!abort.signal.aborted) setMessage(text);
				},
				abort.signal,
				rotation === "auto" ? null : Number(rotation)
			);
			setMessage("Распознавание закончено. Проверьте страницы, исправьте и подтвердите строки.");
		} catch (error) {
			setMessage(
				abort.signal.aborted
					? "Распознавание отменено. Частичный результат требует проверки."
					: error instanceof Error
						? error.message
						: "Ошибка распознавания."
			);
		} finally {
			setRunning(false);
			onBusyChange(false);
		}
	}
	function update(index: number, key: keyof typeof columns, value: string) {
		setRows((previous) => previous.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
		onRows(null);
	}
	return (
		<section className="grid gap-3 rounded-lg border p-3">
			<p className="text-sm">
				PDF и сканы: сначала распознайте и проверьте маркировки. Цвета игнорируются; плюсы и даты не изменяют
				готовность автоматически.
			</p>
			<div className="flex flex-wrap gap-2">
				<select
					aria-label="Поворот скана"
					className="rounded border bg-background px-2"
					value={rotation}
					disabled={running || disabled}
					onChange={(event) => setRotation(event.target.value)}>
					<option value="auto">Автоповорот</option>
					{[0, 90, 180, 270].map((angle) => (
						<option key={angle} value={angle}>
							{angle}°
						</option>
					))}
				</select>
				<Button type="button" disabled={running || disabled} onClick={() => void recognize()}>
					Распознать PDF / скан
				</Button>
				{running ? (
					<Button type="button" variant="outline" onClick={() => controller.current?.abort()}>
						Отменить после текущей страницы
					</Button>
				) : null}
			</div>
			<p role="status" className="text-sm">
				{message}
			</p>
			{pages.map((page) => (
				<details key={page.page} className="rounded border p-2 text-sm">
					<summary>
						Страница {page.page}:{" "}
						{page.error ? `ошибка — ${page.error}` : `${page.rows.length} найденных строк, ${page.rotation}°`}
					</summary>
					{page.preview ? (
						<img src={page.preview} alt={`Исходная страница ${page.page}`} className="w-full" />
					) : null}
					<pre className="max-h-48 overflow-auto whitespace-pre-wrap">{page.text}</pre>
				</details>
			))}
			{pages.some((page) => page.error || page.rows.length === 0) ? (
				<p className="text-sm text-amber-700">
					Есть страницы без распознанных строк. Проверьте оригинал, измените поворот или добавьте строки
					вручную. При подтверждении будут использованы только строки таблицы ниже.
				</p>
			) : null}
			{rows.length > 0 ? (
				<div className="max-h-96 overflow-auto">
					<table className="w-full text-xs">
						<thead>
							<tr>
								<th>Стр.</th>
								{Object.values(columns).map((label) => (
									<th key={label}>{label}</th>
								))}
								<th>Источник</th>
								<th>Исключить</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((row, index) => (
								<tr key={index}>
									<td>
										<Input
											aria-label={`Страница строки ${index + 1}`}
											type="number"
											min={1}
											max={50}
											value={row.page}
											disabled={running || disabled}
											onChange={(event) => {
												setRows((previous) =>
													previous.map((item, i) =>
														i === index ? { ...item, page: Number(event.target.value) } : item
													)
												);
												onRows(null);
											}}
										/>
									</td>
									{(Object.keys(columns) as Array<keyof typeof columns>).map((key) => (
										<td key={key}>
											<Input
												aria-label={`${columns[key]}, строка ${index + 1}`}
												className="min-w-32"
												value={row[key]}
												disabled={running || disabled}
												onChange={(event) => update(index, key, event.target.value)}
											/>
										</td>
									))}
									<td className="min-w-64">
										{row.confidence !== null ? (
											<span className="block">OCR: {Math.round(row.confidence)}%</span>
										) : null}
										{row.sourceText}
									</td>
									<td>
										<Button
											type="button"
											variant="ghost"
											disabled={running || disabled}
											onClick={() => {
												setRows((previous) => previous.filter((_, i) => i !== index));
												onRows(null);
											}}>
											×
										</Button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : null}
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={running || disabled}
					onClick={() => {
						setRows((previous) => [
							...previous,
							{ ...documentCableRowSchema.parse({ page: 1, cableLabel: "new" }), cableLabel: "" },
						]);
						onRows(null);
					}}>
					Добавить строку вручную
				</Button>
				<Button
					type="button"
					disabled={running || disabled || rows.length === 0}
					onClick={() => {
						try {
							const checked = rows.map((row) => documentCableRowSchema.parse(row));
							onRows(checked);
							toast.success("Строки проверены. Теперь выполните анализ по кабельной базе.");
						} catch {
							toast.error("Проверьте маркировки и номера страниц (1–50).");
						}
					}}>
					Строки проверены
				</Button>
			</div>
		</section>
	);
}
