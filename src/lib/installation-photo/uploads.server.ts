import { eq } from "drizzle-orm";
import { z } from "zod";

import type { AuthSession } from "@/lib/auth/shared";
import { getDb } from "@/lib/db";
import { installationSnapshots } from "@/lib/db/schema";
import { archiveUpload } from "@/lib/uploads.server";

export async function archiveInstallationPhoto(data: FormData, session: AuthSession) {
	if (data.get("userId") !== session.id) throw new Error("Фото принадлежит другому пользователю.");
	const snapshotId = z.uuid().parse(data.get("snapshotId"));
	const file = data.get("file");
	if (
		!(file instanceof File) ||
		!file.type.startsWith("image/") ||
		file.size === 0 ||
		file.size > 25 * 1024 * 1024
	)
		throw new Error("Выберите изображение размером до 25 МБ.");
	const [snapshot] = await getDb()
		.select({ id: installationSnapshots.id })
		.from(installationSnapshots)
		.where(eq(installationSnapshots.id, snapshotId))
		.limit(1);
	if (!snapshot) throw new Error("Снимок монтажа для фото не найден.");
	return { key: await archiveUpload(file, session.id, `installation-photo:${snapshotId}`) };
}
