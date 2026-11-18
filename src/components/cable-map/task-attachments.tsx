"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AuthSession } from "@/lib/auth/shared";
import { attachKanbanFile, downloadKanbanFile } from "@/lib/cable-map/functions";
import type { PriorityListKanbanStatus } from "@/lib/cable-map/shared";
import type { DocumentCableRow } from "@/lib/cable-map/task-documents";
import { getTaskDocumentStage, taskDocumentAccept } from "@/lib/cable-map/task-documents";
import { downloadResponseFile } from "@/lib/utils";

import { DocumentRecognition } from "./document-recognition";

export function TaskAttachments({
	listId,
	status,
	session,
	attachments,
	onChange,
}: {
	listId: string;
	status: PriorityListKanbanStatus;
	session: AuthSession;
	attachments: Array<{ id: string; fileName: string; sizeBytes: number }>;
	onChange: () => Promise<void>;
}) {
	const [pending, setPending] = useState(false);
	const [file, setFile] = useState<File | null>(null);
	const [recognize, setRecognize] = useState(true);
	const [ocrBusy, setOcrBusy] = useState(false);
	const [rows, setRows] = useState<DocumentCableRow[] | null>(null);
	const [revision, setRevision] = useState(0);
	const input = useRef<HTMLInputElement>(null);
	async function upload() {
		if (!file || pending || ocrBusy || (recognize && !rows)) return;
		setPending(true);
		try {
			const data = new FormData();
			data.set("listId", listId);
			data.set("file", file);
			if (recognize && rows) data.set("reviewedRows", JSON.stringify(rows));
			const result = await attachKanbanFile({ data });
			await onChange();
			setFile(null);
			setRows(null);
			if (input.current) input.current.value = "";
			toast.success(
				recognize
					? "Документ сохранён. Подтверждённые отметки выполнения применены."
					: result.reused
						? "Этот файл уже прикреплён."
						: "Вложение сохранено."
			);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось прикрепить файл.");
		} finally {
			setPending(false);
		}
	}
	async function download(id: string, fileName: string) {
		setPending(true);
		try {
			const response = await downloadKanbanFile({ data: id });
			await downloadResponseFile(response, fileName);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось скачать вложение.");
		} finally {
			setPending(false);
		}
	}
	return (
		<section className="grid gap-2 rounded-lg border p-3">
			<h3 className="font-medium">Вложения</h3>
			{attachments.length === 0 ? <p className="text-sm text-muted-foreground">Вложений пока нет.</p> : null}
			{attachments.map((attachment) => (
				<Button
					key={attachment.id}
					type="button"
					variant="outline"
					disabled={pending}
					className="justify-start whitespace-normal break-all"
					onClick={() => void download(attachment.id, attachment.fileName)}>
					{attachment.fileName} · {Math.ceil(attachment.sizeBytes / 1024)} КБ
				</Button>
			))}
			{getTaskDocumentStage(session) === status ? (
				<div className="grid gap-2">
					<label>
						<input
							type="checkbox"
							checked={recognize}
							disabled={pending || ocrBusy}
							onChange={(event) => {
								setRecognize(event.target.checked);
								setRows(null);
								setRevision((value) => value + 1);
							}}
						/>{" "}
						Распознать кабели и отметки выполнения
					</label>
					<Input
						ref={input}
						aria-label="Прикрепить PDF или скан"
						type="file"
						accept={taskDocumentAccept}
						disabled={pending || ocrBusy}
						onChange={(event) => {
							setFile(event.target.files?.[0] ?? null);
							setRows(null);
							setRevision((value) => value + 1);
						}}
					/>
					{file && recognize ? (
						<DocumentRecognition
							key={revision}
							file={file}
							onRows={setRows}
							disabled={pending}
							onBusyChange={setOcrBusy}
						/>
					) : null}
					<Button
						type="button"
						disabled={!file || pending || ocrBusy || (recognize && !rows)}
						onClick={() => void upload()}>
						{pending ? "Подождите…" : recognize ? "Сохранить файл и выполнение" : "Прикрепить файл"}
					</Button>
					<p className="text-xs text-muted-foreground">
						PDF, JPEG или PNG до 25 МБ. При распознавании подтвердите выполнение только кабелей этой карточки.
					</p>
				</div>
			) : (
				<p className="text-xs text-muted-foreground">
					Добавление файлов доступно только в столбце вашего подразделения.
				</p>
			)}
		</section>
	);
}
