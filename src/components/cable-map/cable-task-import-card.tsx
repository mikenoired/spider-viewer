"use client";

import { useRouter } from "@tanstack/react-router";
import { FileSearchIcon, LoaderCircleIcon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AuthSession } from "@/lib/auth/shared";
import { departmentLabels } from "@/lib/auth/shared";
import { analyzeCableTaskList, seedKanbanDemo, uploadCableTaskList } from "@/lib/cable-map/functions";
import type { PriorityListKanbanStatus, TaskPriority } from "@/lib/cable-map/shared";

const stageLabels: Record<PriorityListKanbanStatus, string> = {
	formed: "Список сформирован",
	in_progress: "Список в работе",
	curator_review: "На проверку куратору",
	adjustment: "Список в наладке",
	done: "Список выполнен",
};

type Analysis = Awaited<ReturnType<typeof analyzeCableTaskList>>;

export function CableTaskImportCard({ session }: { session: AuthSession }) {
	const router = useRouter();
	const [file, setFile] = useState<File | null>(null);
	const [analysis, setAnalysis] = useState<Analysis | null>(null);
	const [stage, setStage] = useState<PriorityListKanbanStatus>("formed");
	const [title, setTitle] = useState("");
	const [priority, setPriority] = useState<TaskPriority>("normal");
	const [deadline, setDeadline] = useState("");
	const [analyzing, setAnalyzing] = useState(false);
	const [importing, setImporting] = useState(false);

	async function analyze() {
		if (!file) {
			toast.error("Выберите Excel/LibreOffice файл со списком кабелей.");
			return;
		}

		setAnalyzing(true);
		try {
			const formData = new FormData();
			formData.set("file", file);
			const result = await analyzeCableTaskList({ data: formData });
			setAnalysis(result);
			setStage(result.allowedStages[0] ?? "formed");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось проанализировать список.");
		} finally {
			setAnalyzing(false);
		}
	}

	async function confirmImport() {
		if (!file || !analysis) return;
		if (!analysis.allowedStages.includes(stage)) {
			toast.error("Выберите разрешённый этап Kanban.");
			return;
		}

		setImporting(true);
		try {
			const formData = new FormData();
			formData.set("file", file);
			formData.set("stage", stage);
			formData.set("title", title || file.name);
			formData.set("priority", priority);
			if (deadline) formData.set("deadline", deadline);
			const result = await uploadCableTaskList({ data: formData });
			await router.invalidate();
			window.location.hash = `kanban-task-${result.id}`;
			toast.success(
				result.reused
					? "Этот файл уже был импортирован: открыта существующая карточка."
					: `Создана карточка: ${result.matchedCount} кабелей, не найдено ${result.missingCount}.`
			);
			setAnalysis(null);
			setFile(null);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось импортировать список.");
		} finally {
			setImporting(false);
		}
	}
	async function createDemo() {
		setImporting(true);
		try {
			const result = await seedKanbanDemo();
			await router.invalidate();
			toast.success(result.message);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось создать демонстрационные списки.");
		} finally {
			setImporting(false);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Импорт рабочего списка кабелей</CardTitle>
				<CardDescription>
					Шаг 1 — файл, шаг 2 — сопоставление с генеральной базой, шаг 3 — выбор этапа и создание задачи.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-4">
				<FieldGroup>
					<Field>
						<FieldLabel htmlFor="cable-task-title">Название карточки</FieldLabel>
						<Input
							id="cable-task-title"
							value={title}
							onChange={(event) => setTitle(event.target.value)}
							placeholder="По умолчанию — имя файла"
							disabled={analyzing || importing}
						/>
					</Field>
					<Field>
						<FieldLabel>Приоритет</FieldLabel>
						<select
							className="h-9 rounded-md border bg-background px-3"
							value={priority}
							onChange={(event) => setPriority(event.target.value as TaskPriority)}
							disabled={analyzing || importing}>
							<option value="high">Первый / высокий</option>
							<option value="normal">Второй / обычный</option>
							<option value="low">Третий / низкий</option>
						</select>
					</Field>
					<Field>
						<FieldLabel htmlFor="cable-task-deadline">Плановый срок (необязательно)</FieldLabel>
						<Input
							id="cable-task-deadline"
							type="date"
							value={deadline}
							onChange={(event) => setDeadline(event.target.value)}
							disabled={analyzing || importing}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="cable-task-file">Список кабелей</FieldLabel>
						<Input
							id="cable-task-file"
							type="file"
							accept=".ods,.xlsx,.xls"
							disabled={analyzing || importing}
							onChange={(event) => {
								setFile(event.target.files?.[0] ?? null);
								setAnalysis(null);
							}}
						/>
						<FieldDescription>
							Распознаются маркировка/кабель, журнал и номер нитки; столбец «Прогресс» обновит только
							указанные значения.
						</FieldDescription>
					</Field>
				</FieldGroup>

				{analysis ? (
					<div className="grid gap-3 rounded-lg border bg-muted/20 p-3 text-sm">
						<div className="flex flex-wrap gap-2">
							<Badge>
								Найдено: {analysis.matchedCount} из {analysis.totalCount}
							</Badge>
							<Badge variant="outline">Не найдено: {analysis.missing.length}</Badge>
							<Badge variant="outline">Неоднозначно: {analysis.ambiguous.length}</Badge>
							<Badge variant="secondary">Генеральная база: {analysis.baseCount}</Badge>
						</div>
						{analysis.missing.length > 0 || analysis.ambiguous.length > 0 ? (
							<details className="rounded border bg-background p-2">
								<summary className="cursor-pointer font-medium">Проблемные позиции</summary>
								{analysis.missing.length > 0 ? (
									<div className="mt-2">Не найдены: {analysis.missing.join(", ")}</div>
								) : null}
								{analysis.ambiguous.length > 0 ? (
									<div className="mt-2">Неоднозначны: {analysis.ambiguous.join(", ")}</div>
								) : null}
							</details>
						) : null}
						{analysis.allowedStages.length > 0 ? (
							<label className="grid gap-1">
								<span className="text-xs font-medium">Куда добавить загруженный список</span>
								<select
									className="h-9 rounded-md border bg-background px-3"
									value={stage}
									onChange={(event) => setStage(event.target.value as PriorityListKanbanStatus)}>
									{analysis.allowedStages.map((item) => (
										<option key={item} value={item}>
											{stageLabels[item]}
										</option>
									))}
								</select>
							</label>
						) : (
							<div className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
								Для подразделения «{departmentLabels[session.department]}» импорт списка в Kanban не разрешён.
							</div>
						)}
					</div>
				) : null}

				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="outline"
						onClick={() => void analyze()}
						disabled={!file || analyzing || importing}>
						{analyzing ? <LoaderCircleIcon className="animate-spin" /> : <FileSearchIcon />}
						Анализировать файл
					</Button>
					{analysis ? (
						<Button
							type="button"
							onClick={() => void confirmImport()}
							disabled={importing || analysis.matchedCount === 0 || analysis.allowedStages.length === 0}>
							{importing ? <LoaderCircleIcon className="animate-spin" /> : <UploadIcon />}
							Подтвердить импорт
						</Button>
					) : null}
					{session.role === "super-admin" ? (
						<Button
							type="button"
							variant="secondary"
							disabled={importing || analyzing}
							onClick={() => void createDemo()}>
							Создать 3 демонстрационных списка
						</Button>
					) : null}
				</div>
			</CardContent>
		</Card>
	);
}
