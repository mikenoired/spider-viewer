"use client";

import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import {
	uploadInstallationCableBase,
	uploadInstallationProgressWorkbooks,
	uploadInstallationWorkbook,
} from "@/lib/installation/functions";
import type { InstallationSnapshotView } from "@/lib/installation/shared";

import { InstallationImportPanel } from "./installation-import-panel";

export function InstallationImportForm({ snapshot }: { snapshot: InstallationSnapshotView | null }) {
	const router = useRouter();
	const [importing, setImporting] = useState(false);
	const [importingBase, setImportingBase] = useState(false);
	const [importingProgress, setImportingProgress] = useState(false);

	async function handleUpload(file: File, baseFile: File | null) {
		setImporting(true);

		try {
			const formData = new FormData();
			formData.set("file", file);
			if (baseFile) formData.set("baseFile", baseFile);

			const result = await uploadInstallationWorkbook({ data: formData });

			await router.invalidate();
			toast.success(`Монтаж импортирован: ${result.kksCount} KKS, ${result.groupCount} групп.`);
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

	async function handleBaseUpload(file: File) {
		setImportingBase(true);

		try {
			const formData = new FormData();
			formData.set("file", file);

			const result = await uploadInstallationCableBase({ data: formData });

			await router.invalidate();
			toast.success(
				`База контроля загружена: найдено ${result.matchedCableCount}, готово ${result.baseDoneCount}, обновлено ${result.changedCableCount}.`
			);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось загрузить базу контроля кабелей.");
		} finally {
			setImportingBase(false);
		}
	}

	return (
		<InstallationImportPanel
			canEdit
			importing={importing}
			importingBase={importingBase}
			importingProgress={importingProgress}
			snapshot={snapshot}
			onBaseUpload={handleBaseUpload}
			onUpload={handleUpload}
			onProgressUpload={handleProgressUpload}
		/>
	);
}
