import { z } from "zod";

import type { AuthSession } from "@/lib/auth/shared";

import type { PriorityListKanbanStatus } from "./shared";

export const taskDocumentAccept = ".pdf,.png,.jpg,.jpeg";
export const taskDocumentMaxBytes = 25 * 1024 * 1024;

export function getTaskDocumentStage(
	session: Pick<AuthSession, "department">
): PriorityListKanbanStatus | null {
	if (session.department === "tai") return "formed";
	if (session.department === "skm") return "in_progress";
	if (session.department === "commissioning") return "adjustment";
	return null;
}

export function assertTaskDocumentStage(session: Pick<AuthSession, "department">, stage: string) {
	if (getTaskDocumentStage(session) !== stage || !getTaskDocumentStage(session)) {
		throw new Error("Добавлять PDF и сканы можно только в свой столбец Kanban.");
	}
}

export function isTaskDocument(file: Pick<File, "name">) {
	return /\.(pdf|png|jpe?g)$/i.test(file.name);
}

export async function validateTaskDocument(file: File) {
	if (!isTaskDocument(file) || !file.size || file.size > taskDocumentMaxBytes) {
		throw new Error("Выберите PDF, JPEG или PNG размером до 25 МБ.");
	}
	const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
	const extension = file.name.split(".").pop()!.toLowerCase();
	const type: "application/pdf" | "image/png" | "image/jpeg" =
		extension === "pdf" ? "application/pdf" : extension === "png" ? "image/png" : "image/jpeg";
	const valid =
		type === "application/pdf"
			? String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-"
			: type === "image/png"
				? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
				: bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
	if (!valid || (file.type && file.type !== type && file.type !== "application/octet-stream")) {
		throw new Error("Содержимое файла не соответствует формату PDF/JPEG/PNG.");
	}
	return { fileType: extension, contentType: type };
}

const field = z.string().trim().max(500).default("");
export const documentCableRowSchema = z.object({
	page: z.number().int().min(1).max(50),
	cableLabel: z.string().trim().min(1).max(200),
	cableNumber: field,
	fromRoom: field,
	toRoom: field,
	cableType: field,
	section: field,
	length: field,
	route: field,
	drum: field,
	sourceText: z.string().max(4000).default(""),
	confidence: z.number().min(0).max(100).nullable().default(null),
});
export const documentCableRowsSchema = z.array(documentCableRowSchema).min(1).max(5000);
export type DocumentCableRow = z.infer<typeof documentCableRowSchema>;

// Equipment KKS (e.g. 1HX98) is not a cable marking (1HX98K176 or 1HX48-01).
export function extractDocumentCableRows(text: string, page: number): DocumentCableRow[] {
	return text.split(/\r?\n/).flatMap((line) => {
		const labels =
			line
				.toUpperCase()
				.match(/[1-9][A-ZА-ЯЁ0-9]{2,}?(?:[KК]\d{2,}[A-ZА-Я]?|-\d+[A-ZА-Я]?)(?![A-ZА-Я0-9])/g) ?? [];
		return [...new Set(labels)].map((cableLabel) =>
			documentCableRowSchema.parse({
				page,
				cableLabel,
				sourceText: line.trim(),
				cableNumber: line.trim().match(/^[+|[\]\s]*(\d{1,6})\s/)?.[1] ?? "",
				section: line.match(/\b\d{1,3}[xхХX*×]\d+(?:[,.]\d+)?\b/)?.[0] ?? "",
				drum: line.match(/\b\d{8,12}\b(?=[^\d]*$)/)?.[0] ?? "",
			})
		);
	});
}
