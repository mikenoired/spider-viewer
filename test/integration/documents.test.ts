import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createHash, randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { AuthSession } from "@/lib/auth/shared";
import * as schema from "@/lib/db/schema";
import * as uploads from "@/lib/uploads.server";

import { clearHistory } from "../../scripts/clear-history";
import * as storage from "../../scripts/storage";
const { addTaskAttachment, getTaskAttachments, downloadTaskAttachment } =
	await import("@/lib/cable-map/task-attachments.server");
const { analyzeCableTaskListFromFormData, importCableTaskListFromFormData } =
	await import("@/lib/cable-map/task-workflow.server");
const testUrl = process.env.APP_TEST_DATABASE_URL;

describe.skipIf(!testUrl)("PDF and scan Kanban operations with PostgreSQL", () => {
	let archive: ReturnType<typeof spyOn<typeof uploads, "archiveUpload">>;
	let client: ReturnType<typeof postgres>;
	let db: ReturnType<typeof drizzle<typeof schema>>;
	const oldUploads = process.env.S3_UPLOADS_ENABLED;
	const master: AuthSession = {
		id: randomUUID(),
		login: "documents-master",
		role: "super-admin",
		department: "tai",
	};
	const mounting: AuthSession = {
		id: randomUUID(),
		login: "documents-mounting",
		role: "user",
		department: "skm",
	};
	const commissioning: AuthSession = {
		id: randomUUID(),
		login: "documents-commissioning",
		role: "user",
		department: "commissioning",
	};
	beforeAll(() => {
		if (!testUrl || testUrl === process.env.DATABASE_URL || !/test/i.test(new URL(testUrl).pathname))
			throw new Error("Use a separate disposable test database.");
		archive = spyOn(uploads, "archiveUpload");
		client = postgres(testUrl, { prepare: false, onnotice: () => undefined });
		db = drizzle(client, { schema });
		globalThis.__spiderViewerDb__ = db;
		process.env.S3_UPLOADS_ENABLED = "true";
	});
	async function saveMockArchive(file: File, userId: string, purpose: string) {
		const checksum = createHash("sha256")
			.update(new Uint8Array(await file.arrayBuffer()))
			.digest("hex");
		await db.insert(schema.uploadedFiles).values({
			objectKey: "uploads/test/original",
			fileName: file.name,
			contentType: file.type,
			sizeBytes: file.size,
			checksum,
			purpose,
			uploadedByUserId: userId,
		});
		return "uploads/test/original";
	}
	beforeEach(async () => {
		archive.mockReset();
		archive.mockImplementation(saveMockArchive);
		await db.execute(sql`truncate table users cascade`);
		await db
			.insert(schema.users)
			.values([master, mounting, commissioning].map((session) => ({ ...session, passwordHash: "unused" })));
	});
	afterAll(async () => {
		archive?.mockRestore();
		globalThis.__spiderViewerDb__ = undefined;
		if (oldUploads === undefined) delete process.env.S3_UPLOADS_ENABLED;
		else process.env.S3_UPLOADS_ENABLED = oldUploads;
		await client?.end();
	});
	async function task(status: "formed" | "in_progress" | "adjustment" = "in_progress") {
		const [list] = await db
			.insert(schema.priorityRoomLists)
			.values({
				authorName: master.login,
				fileName: "task.pdf",
				fileType: "pdf",
				status,
				importedByUserId: master.id,
			})
			.returning();
		return list!;
	}
	function data(listId?: string) {
		const form = new FormData();
		form.set("file", new File(["%PDF-1.7 original"], "task.pdf", { type: "application/pdf" }));
		if (listId) form.set("listId", listId);
		return form;
	}
	it("rejects attachments in another department's column even for MASTER, before archiving", async () => {
		const list = await task();
		for (const session of [master, commissioning])
			await expect(addTaskAttachment(data(list.id), session)).rejects.toThrow("свой столбец");
		expect(archive).not.toHaveBeenCalled();
		expect(await getTaskAttachments(list.id)).toHaveLength(0);
	});
	it("attaches the original once and leaves cables and completion unchanged", async () => {
		const list = await task();
		const result = await addTaskAttachment(data(list.id.toUpperCase()), mounting);
		expect(result.reused).toBe(false);
		expect(await addTaskAttachment(data(list.id), mounting)).toEqual({ id: result.id, reused: true });
		const attachments = await getTaskAttachments(list.id);
		expect(attachments).toHaveLength(1);
		expect(attachments[0]).not.toHaveProperty("objectKey");
		expect(await db.select().from(schema.cableListItems)).toHaveLength(0);
		expect((await db.select().from(schema.priorityRoomLists))[0]?.status).toBe("in_progress");
	});
	it("rechecks the locked current column after the archive upload", async () => {
		const list = await task();
		archive.mockImplementationOnce(async (file, userId, purpose) => {
			await db
				.update(schema.priorityRoomLists)
				.set({ status: "adjustment" })
				.where(eq(schema.priorityRoomLists.id, list.id));
			return saveMockArchive(file, userId, purpose);
		});
		await expect(addTaskAttachment(data(list.id), mounting)).rejects.toThrow("свой столбец");
		expect(await getTaskAttachments(list.id)).toHaveLength(0);
	});
	it("archive failure leaves no attachment event", async () => {
		const list = await task();
		archive.mockRejectedValueOnce(new Error("archive unavailable"));
		await expect(addTaskAttachment(data(list.id), mounting)).rejects.toThrow("archive unavailable");
		expect(await getTaskAttachments(list.id)).toHaveLength(0);
	});
	it("analyzes reviewed scan rows and creates a list only in the mounting column without changing progress", async () => {
		const [cable] = await db
			.insert(schema.cables)
			.values({
				externalKey: "test-cable",
				cableLabel: "1HX98K176",
				cableMarking: "1HX98K176",
				fromRoom: "A101",
				toRoom: "A102",
				progress: 30,
			})
			.returning();
		const form = data();
		form.set("reviewedRows", JSON.stringify([{ page: 1, cableLabel: "1HX98K176", progress: 100 }]));
		const analysis = await analyzeCableTaskListFromFormData(form, mounting);
		expect(analysis.allowedStages).toEqual(["in_progress"]);
		expect(analysis.matchedCount).toBe(1);
		form.set("stage", "formed");
		await expect(importCableTaskListFromFormData(form, mounting)).rejects.toThrow("свой столбец");
		form.set("stage", "in_progress");
		const result = await importCableTaskListFromFormData(form, mounting);
		expect(await getTaskAttachments(result.id)).toHaveLength(1);
		expect(
			(await db.select().from(schema.priorityRoomLists).where(eq(schema.priorityRoomLists.id, result.id)))[0]
				?.responsibleUserId
		).toBe(mounting.id);
		expect((await db.select().from(schema.cables).where(eq(schema.cables.id, cable!.id)))[0]?.progress).toBe(
			30
		);
		expect((await db.select().from(schema.cableListItems))[0]?.importedProgress).toBeNull();
		expect((await importCableTaskListFromFormData(form, mounting)).id).toBe(result.id);
	});
	it("rejects oversized row collections before schema error expansion and archiving", async () => {
		const form = data();
		form.set("reviewedRows", JSON.stringify(Array(5001).fill(null)));
		await expect(analyzeCableTaskListFromFormData(form, mounting)).rejects.toThrow("5000");
		expect(archive).not.toHaveBeenCalled();
	});
	it("concurrent confirmations create one card and one original attachment", async () => {
		await db.insert(schema.cables).values({
			externalKey: "parallel-test",
			cableLabel: "1HX98K176",
			cableMarking: "1HX98K176",
			fromRoom: "A101",
			toRoom: "A102",
		});
		function form() {
			const result = data();
			result.set("stage", "in_progress");
			result.set("reviewedRows", JSON.stringify([{ page: 1, cableLabel: "1HX98K176" }]));
			return result;
		}
		const result = await Promise.all([
			importCableTaskListFromFormData(form(), mounting),
			importCableTaskListFromFormData(form(), mounting),
		]);
		expect(result[0]!.id).toBe(result[1]!.id);
		expect(result.filter((item) => item.reused)).toHaveLength(1);
		expect(await db.select().from(schema.priorityRoomLists)).toHaveLength(1);
		expect(await getTaskAttachments(result[0]!.id)).toHaveLength(1);
	});
	it("downloads only the stored attachment with private response headers", async () => {
		const list = await task();
		const { id } = await addTaskAttachment(data(list.id), mounting);
		const bytes = new TextEncoder().encode("%PDF-1.7 original");
		const file = spyOn(storage, "getStorageClient").mockReturnValue({
			file: (key: string) => {
				expect(key).toBe("uploads/test/original");
				return {
					stream: () =>
						new ReadableStream({
							start(controller) {
								controller.enqueue(bytes);
								controller.close();
							},
						}),
				};
			},
		} as unknown as ReturnType<typeof storage.getStorageClient>);
		try {
			const response = await downloadTaskAttachment(id);
			expect(response.headers.get("Cache-Control")).toBe("private, no-store");
			expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
			expect(await response.text()).toBe("%PDF-1.7 original");
			await expect(downloadTaskAttachment(randomUUID())).rejects.toThrow("Вложение не найдено");
		} finally {
			file.mockRestore();
		}
	});
	it("keeps attachments after audit history is cleared and hides orphaned archive attempts", async () => {
		const list = await task();
		await addTaskAttachment(data(list.id), mounting);
		await clearHistory(client, true, async () => ({ key: "test-backup", sha256: "test", bytes: 1 }));
		expect(await getTaskAttachments(list.id)).toHaveLength(1);
		await db.delete(schema.priorityRoomLists).where(eq(schema.priorityRoomLists.id, list.id));
		expect(await getTaskAttachments(list.id)).toHaveLength(0);
	});
});
