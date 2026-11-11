"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AuthSession } from "@/lib/auth/shared";
import { attachKanbanFile, downloadKanbanFile } from "@/lib/cable-map/functions";
import type { PriorityListKanbanStatus } from "@/lib/cable-map/shared";
import { getTaskDocumentStage, taskDocumentAccept } from "@/lib/cable-map/task-documents";
import { downloadResponseFile } from "@/lib/utils";

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
	const input = useRef<HTMLInputElement>(null);
	async function upload() {
		if (!file || pending) return;
		setPending(true);
		try {
			const data = new FormData();
			data.set("listId", listId);
			data.set("file", file);
			const result = await attachKanbanFile({ data });
			await onChange();
			setFile(null);
			if (input.current) input.current.value = "";
			toast.success(result.reused ? "Этот файл уже прикреплён." : "Вложение сохранено.");
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
				<div className="flex flex-wrap gap-2">
					<Input
						ref={input}
						aria-label="Прикрепить PDF или скан"
						type="file"
						accept={taskDocumentAccept}
						disabled={pending}
						onChange={(event) => setFile(event.target.files?.[0] ?? null)}
					/>
					<Button type="button" disabled={!file || pending} onClick={() => void upload()}>
						{pending ? "Подождите…" : "Прикрепить файл"}
					</Button>
					<p className="text-xs text-muted-foreground">
						PDF, JPEG или PNG до 25 МБ. Вложение не меняет список кабелей и их готовность.
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
