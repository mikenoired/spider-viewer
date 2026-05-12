"use client";

import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { uploadInstallationWorkbook } from "@/lib/installation/functions";
import type { InstallationSnapshotView } from "@/lib/installation/shared";

import { InstallationImportPanel } from "./installation-import-panel";

export function InstallationImportForm({ snapshot }: { snapshot: InstallationSnapshotView | null }) {
	const router = useRouter();
	const [importing, setImporting] = useState(false);

	async function handleUpload(file: File) {
		setImporting(true);

		try {
			const formData = new FormData();
			formData.set("file", file);
			const result = await uploadInstallationWorkbook({ data: formData });

			await router.invalidate();
			toast.success(`Монтаж импортирован: ${result.groupCount} групп, ${result.kksCount} KKS.`);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось импортировать монтаж.");
		} finally {
			setImporting(false);
		}
	}

	return (
		<InstallationImportPanel canEdit importing={importing} snapshot={snapshot} onUpload={handleUpload} />
	);
}
