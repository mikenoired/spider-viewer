import { createHash } from "node:crypto";

import { getStorageClient } from "../../scripts/storage";
import { getDb } from "./db";
import { uploadedFiles } from "./db/schema";

export async function archiveUpload(file: File, userId: string, purpose: string) {
	if (process.env.S3_UPLOADS_ENABLED !== "true") return null;
	const buffer = await file.arrayBuffer();
	const checksum = createHash("sha256").update(new Uint8Array(buffer)).digest("hex");
	const key = `uploads/${userId}/${checksum}`;
	const storage = getStorageClient();
	await storage.write(key, buffer, { type: file.type || "application/octet-stream" });
	if ((await storage.stat(key)).size !== file.size)
		throw new Error("Не удалось проверить сохраненный оригинал файла.");
	// Archive first: an import must never commit when its original failed to upload.
	// A failed import may leave an archived attempt, which is intentional and recoverable.
	await getDb()
		.insert(uploadedFiles)
		.values({
			objectKey: key,
			fileName: file.name,
			contentType: file.type || "application/octet-stream",
			checksum,
			sizeBytes: file.size,
			purpose,
			uploadedByUserId: userId,
		});
	return key;
}
