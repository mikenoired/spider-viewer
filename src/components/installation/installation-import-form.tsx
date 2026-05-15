"use client";

import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import type { SnapshotSummaryView } from "@/lib/cable-map/shared";
import {
	uploadInstallationProgressWorkbooks,
	uploadInstallationWorkbook,
} from "@/lib/installation/functions";

import { InstallationImportPanel } from "./installation-import-panel";

export function InstallationImportForm({ snapshot }: { snapshot: SnapshotSummaryView | null }) {
	const router = useRouter();
	const [importing, setImporting] = useState(false);
	const [importingProgress, setImportingProgress] = useState(false);

	async function handleUpload(file: File) {
		setImporting(true);

		try {
			const formData = new FormData();
			formData.set("file", file);
			const result = await uploadInstallationWorkbook({ data: formData });

			await router.invalidate();
			toast.success(`Карта монтажа импортирована: ${result.rowCount} строк, ${result.groupCount} групп.`);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось импортировать монтаж.");
		} finally {
			setImporting(false);
		}
	}

	async function handleProgressUpload(files: File[]) {
		setImportingProgress(true);

		try {
			const formData = new FormData();

			for (const file of files) {
				formData.append("files", file);
			}

			const result = await uploadInstallationProgressWorkbooks({ data: formData });

			await router.invalidate();
			toast.success(
				`Выполненные работы загружены: найдено ${result.matchedCableCount}, обновлено ${result.changedCableCount}.`
			);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось загрузить выполненные работы.");
		} finally {
			setImportingProgress(false);
		}
	}

	return (
		<InstallationImportPanel
			canEdit
			importing={importing}
			importingProgress={importingProgress}
			snapshot={snapshot}
			onUpload={handleUpload}
			onProgressUpload={handleProgressUpload}
		/>
	);
}
