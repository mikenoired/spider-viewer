import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { processBatch } from "./use-cases/process-batch";

const maxUploadBytes = 250 * 1024 * 1024;

function crc32(buffer: Uint8Array) {
	let crc = 0xffffffff;
	for (const value of buffer) {
		crc ^= value;
		for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: Array<{ name: string; data: Uint8Array }>) {
	let offset = 0;
	const locals: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	for (const entry of entries) {
		const name = Buffer.from(entry.name);
		const crc = crc32(entry.data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(entry.data.length, 18);
		local.writeUInt32LE(entry.data.length, 22);
		local.writeUInt16LE(name.length, 26);
		const centralEntry = Buffer.alloc(46);
		centralEntry.writeUInt32LE(0x02014b50, 0);
		centralEntry.writeUInt16LE(20, 4);
		centralEntry.writeUInt16LE(20, 6);
		centralEntry.writeUInt32LE(crc, 16);
		centralEntry.writeUInt32LE(entry.data.length, 20);
		centralEntry.writeUInt32LE(entry.data.length, 24);
		centralEntry.writeUInt16LE(name.length, 28);
		centralEntry.writeUInt32LE(offset, 42);
		locals.push(local, name, entry.data);
		central.push(centralEntry, name);
		offset += local.length + name.length + entry.data.length;
	}
	const centralSize = central.reduce((size, item) => size + item.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralSize, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, ...central, end]);
}

function safeRelativePath(value: unknown, fallback: string) {
	const candidate = typeof value === "string" && value.trim() ? value.trim() : fallback;
	const normalized = path.posix.normalize(candidate.replaceAll("\\", "/")).replace(/^\/+/, "");
	if (
		!normalized ||
		normalized === "." ||
		normalized.startsWith("../") ||
		path.posix.isAbsolute(normalized)
	) {
		throw new Error("Недопустимый путь в загружаемой папке.");
	}
	return normalized;
}

export async function convertNppFormData(formData: FormData) {
	const files = formData.getAll("files").filter((value): value is File => value instanceof File);
	if (files.length === 0) throw new Error("Выберите папку с PLS-файлами и SVG.");
	const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
	if (totalBytes > maxUploadBytes) throw new Error("Размер выбранной папки превышает 250 МБ.");

	let suppliedPaths: unknown[] = [];
	try {
		const raw = formData.get("paths");
		suppliedPaths = typeof raw === "string" ? JSON.parse(raw) : [];
	} catch {
		throw new Error("Не удалось прочитать структуру выбранной папки.");
	}
	if (suppliedPaths.length !== files.length)
		throw new Error("Структура выбранной папки не совпадает с файлами.");

	const workspace = path.join(os.tmpdir(), "spider-viewer-npp", randomUUID());
	const inputDir = path.join(workspace, "input");
	const outputDir = path.join(workspace, "output");
	const logs: string[] = [];
	try {
		for (const [index, file] of files.entries()) {
			const relativePath = safeRelativePath(suppliedPaths[index], file.name);
			const destination = path.join(inputDir, relativePath);
			if (!destination.startsWith(`${inputDir}${path.sep}`))
				throw new Error("Недопустимый путь в загружаемой папке.");
			await mkdir(path.dirname(destination), { recursive: true });
			await writeFile(destination, Buffer.from(await file.arrayBuffer()));
		}
		const result = await processBatch(
			{ inputDir, outputDir, concurrency: 2 },
			{ log: (message) => logs.push(message) }
		);
		const documents: Array<{ name: string; data: Uint8Array }> = [];
		for (const message of logs.filter((line) => line.includes(" -> ") && line.includes(" OK "))) {
			const name = message.match(/-> ([^|]+?) \|/)?.[1]?.trim();
			if (name) documents.push({ name, data: await readFile(path.join(outputDir, name)) });
		}
		const archive = zip([
			...documents,
			{ name: "result.json", data: Buffer.from(`${JSON.stringify(result, null, 2)}\n`) },
			{ name: "processing.log", data: Buffer.from(`${logs.join("\n")}\n`) },
		]);
		return { archive, result };
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
}
