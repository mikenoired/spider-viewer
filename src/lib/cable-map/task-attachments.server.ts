import { createHash, randomUUID } from "node:crypto";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { AuthSession } from "@/lib/auth/shared";
import { getDb } from "@/lib/db";
import { cableListItems, cables, priorityRoomLists, taskEvents, uploadedFiles } from "@/lib/db/schema";
import { archiveUpload } from "@/lib/uploads.server";

import { getStorageClient } from "../../../scripts/storage";
import { assertTaskDocumentStage, documentCableRowsSchema, validateTaskDocument } from "./task-documents";

const attachmentSchema = z.object({
	objectKey: z.string().min(1),
	fileName: z.string().max(240),
	contentType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
	sizeBytes: z.number().int().positive(),
	checksum: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ArchivedTaskDocument = z.infer<typeof attachmentSchema> & {
	uploadId: string;
	pendingPurpose: string;
};
type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
const attachmentPurpose = (listId: string) => `kanban-attachment:${listId.toLowerCase()}`;

export async function archiveTaskDocument(file: File, session: AuthSession): Promise<ArchivedTaskDocument> {
	const { contentType } = await validateTaskDocument(file);
	if (file.name.length > 240) throw new Error("Имя файла не должно быть длиннее 240 символов.");
	if (process.env.S3_UPLOADS_ENABLED !== "true")
		throw new Error("Архив вложений не настроен. Обратитесь к администратору.");
	const checksum = createHash("sha256")
		.update(new Uint8Array(await file.arrayBuffer()))
		.digest("hex");
	// Pending attempts are archived, but must not become visible before the locked permission check.
	const pendingPurpose = `kanban-pending:${randomUUID()}`;
	const objectKey = await archiveUpload(
		new File([file], file.name, { type: contentType }),
		session.id,
		pendingPurpose
	);
	if (!objectKey) throw new Error("Оригинал вложения не сохранён.");
	const [upload] = await getDb()
		.select({ id: uploadedFiles.id })
		.from(uploadedFiles)
		.where(
			and(
				eq(uploadedFiles.purpose, pendingPurpose),
				eq(uploadedFiles.objectKey, objectKey),
				eq(uploadedFiles.uploadedByUserId, session.id)
			)
		);
	if (!upload) throw new Error("Не удалось найти сохранённый оригинал вложения.");
	return {
		uploadId: upload.id,
		pendingPurpose,
		objectKey,
		fileName: file.name,
		contentType,
		sizeBytes: file.size,
		checksum,
	};
}

export async function linkTaskDocument(tx: Transaction, listId: string, document: ArchivedTaskDocument) {
	const [linked] = await tx
		.update(uploadedFiles)
		.set({ purpose: attachmentPurpose(listId) })
		.where(and(eq(uploadedFiles.id, document.uploadId), eq(uploadedFiles.purpose, document.pendingPurpose)))
		.returning({ id: uploadedFiles.id });
	if (!linked) throw new Error("Не удалось привязать оригинал к карточке.");
	return linked.id;
}

export async function addTaskAttachment(data: FormData, session: AuthSession) {
	const listId = z.uuid().parse(data.get("listId")).toLowerCase();
	const file = data.get("file");
	if (!(file instanceof File)) throw new Error("Выберите PDF или изображение.");
	const raw = data.get("reviewedRows");
	if (raw !== null && (typeof raw !== "string" || raw.length > 4_000_000))
		throw new Error("Слишком много строк распознавания.");
	const decoded: unknown = raw === null ? null : JSON.parse(raw as string);
	if (decoded !== null && (!Array.isArray(decoded) || decoded.length === 0 || decoded.length > 5000))
		throw new Error("Подтвердите от 1 до 5000 строк документа.");
	const rows = decoded === null ? null : documentCableRowsSchema.parse(decoded);
	const db = getDb();
	const [list] = await db
		.select({ status: priorityRoomLists.status })
		.from(priorityRoomLists)
		.where(eq(priorityRoomLists.id, listId));
	if (!list) throw new Error("Карточка Kanban не найдена.");
	assertTaskDocumentStage(session, list.status);
	const document = await archiveTaskDocument(file, session);
	return db.transaction(async (tx) => {
		const [current] = await tx
			.select({ status: priorityRoomLists.status })
			.from(priorityRoomLists)
			.where(eq(priorityRoomLists.id, listId))
			.for("update");
		if (!current) throw new Error("Карточка Kanban не найдена.");
		assertTaskDocumentStage(session, current.status);
		const [existing] = await tx
			.select({ id: uploadedFiles.id })
			.from(uploadedFiles)
			.where(
				and(
					eq(uploadedFiles.purpose, attachmentPurpose(listId)),
					eq(uploadedFiles.checksum, document.checksum)
				)
			)
			.limit(1);
		// Match against this card only, under its lock. Never complete unrelated base cables.
		if (rows) {
			const { matchParsedTaskCables } = await import("./task-workflow.server");
			const members = await tx
				.select({ cable: cables })
				.from(cableListItems)
				.innerJoin(cables, eq(cables.id, cableListItems.cableId))
				.where(eq(cableListItems.listId, listId));
			const matched = matchParsedTaskCables(
				rows.map((row, index) => ({
					rowIndex: index + 1,
					sheetName: `Страница ${row.page}`,
					cableLabel: row.cableLabel,
					cableNumber: row.cableNumber,
					cableJournal: "",
					fromRoom: row.fromRoom,
					toRoom: row.toRoom,
					progress: row.completed ? 100 : null,
				})),
				members.map((item) => item.cable)
			);
			if (matched.missing.length || matched.ambiguous.length)
				throw new Error(
					`Строки не сопоставлены с карточкой: отсутствуют ${matched.missing.length}, неоднозначны ${matched.ambiguous.length}. ${[...matched.missing, ...matched.ambiguous].slice(0, 10).join(", ")}. Исправьте или исключите их перед сохранением.`
				);
			const now = new Date();
			const completedIds = [
				...new Set(
					matched.matched.filter((item) => item.parsed.progress === 100).map((item) => item.cableId)
				),
			].sort();
			for (let start = 0; start < completedIds.length; start += 500) {
				const ids = completedIds.slice(start, start + 500);
				await tx
					.update(cables)
					.set({ progress: 100, progressUpdatedByUserId: session.id, progressUpdatedAt: now, updatedAt: now })
					.where(inArray(cables.id, ids));
				await tx
					.update(cableListItems)
					.set({ isCompleted: true, importedProgress: 100, completedAt: now, completedByUserId: session.id })
					.where(and(eq(cableListItems.listId, listId), inArray(cableListItems.cableId, ids)));
			}
			await tx.insert(taskEvents).values({
				listId,
				actorUserId: session.id,
				eventType: "document_reviewed",
				message: `${session.login} проверил скан; выполнено позиций: ${matched.matched.filter((item) => item.parsed.progress === 100).length}.`,
				payload: { rows },
			});
		}
		if (existing) return { id: existing.id, reused: true };
		const id = await linkTaskDocument(tx, listId, document);
		await tx.insert(taskEvents).values({
			listId,
			actorUserId: session.id,
			eventType: "attachment_added",
			message: `${session.login} прикрепил файл «${file.name}».`,
			payload: { uploadId: id, fileName: file.name },
		});
		return { id, reused: false };
	});
}

export async function getTaskAttachments(listId: string) {
	const rows = await getDb()
		.select({
			id: uploadedFiles.id,
			fileName: uploadedFiles.fileName,
			contentType: uploadedFiles.contentType,
			sizeBytes: uploadedFiles.sizeBytes,
			createdAt: uploadedFiles.createdAt,
		})
		.from(uploadedFiles)
		.innerJoin(priorityRoomLists, eq(priorityRoomLists.id, listId))
		.where(eq(uploadedFiles.purpose, attachmentPurpose(listId)))
		.orderBy(asc(uploadedFiles.createdAt));
	return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function downloadTaskAttachment(id: string) {
	const [upload] = await getDb()
		.select({
			objectKey: uploadedFiles.objectKey,
			fileName: uploadedFiles.fileName,
			contentType: uploadedFiles.contentType,
			sizeBytes: uploadedFiles.sizeBytes,
			checksum: uploadedFiles.checksum,
		})
		.from(uploadedFiles)
		.innerJoin(
			priorityRoomLists,
			sql`${uploadedFiles.purpose} = 'kanban-attachment:' || ${priorityRoomLists.id}::text`
		)
		.where(eq(uploadedFiles.id, z.uuid().parse(id)));
	if (!upload) throw new Error("Вложение не найдено.");
	const attachment = attachmentSchema.parse(upload);
	return new Response(getStorageClient().file(attachment.objectKey).stream(), {
		headers: {
			"Content-Type": attachment.contentType,
			"Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
			"Cache-Control": "private, no-store",
			"X-Content-Type-Options": "nosniff",
		},
	});
}
