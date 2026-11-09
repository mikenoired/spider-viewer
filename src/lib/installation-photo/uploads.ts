import { getPendingPhotoUploads, removePendingPhotoUpload } from "./offline";

export async function syncPhotoUploads(
	userId: string,
	send: (input: { data: FormData }) => Promise<unknown> = async (input) => {
		const { uploadInstallationPhoto } = await import("@/lib/installation/functions");
		return uploadInstallationPhoto(input);
	}
) {
	let failed = false;
	for (const upload of await getPendingPhotoUploads(userId)) {
		try {
			const data = new FormData();
			data.set("userId", userId);
			data.set("snapshotId", upload.snapshotId);
			data.set(
				"file",
				new File([await upload.image.arrayBuffer()], upload.fileName, { type: upload.image.type })
			);
			await send({ data });
			await removePendingPhotoUpload(upload.id);
		} catch {
			failed = true;
		}
	}
	if (failed) throw new Error("Не удалось отправить часть фото; они остаются в очереди.");
}
