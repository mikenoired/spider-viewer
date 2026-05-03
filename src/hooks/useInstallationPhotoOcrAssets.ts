"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";

import {
	createCheckingInstallationPhotoOcrAssetState,
	getInstallationPhotoOcrAssetState,
	warmInstallationPhotoOcrAssets,
	type InstallationPhotoAssetProgress,
	type InstallationPhotoAssetState,
} from "@/lib/installation-photo/assets";

const setupDismissedStorageKey = "spider-viewer.installation-photo-ocr-setup-dismissed";

function readSetupDismissed() {
	if (typeof window === "undefined") return false;

	return window.localStorage.getItem(setupDismissedStorageKey) === "true";
}

function saveSetupDismissed() {
	window.localStorage.setItem(setupDismissedStorageKey, "true");
}

function usePhotoOcrAssetState(enabled: boolean, setSetupDismissed: Dispatch<SetStateAction<boolean>>) {
	const [assetState, setAssetState] = useState<InstallationPhotoAssetState>(
		createCheckingInstallationPhotoOcrAssetState()
	);

	const refreshAssetState = useCallback(async () => {
		setAssetState(createCheckingInstallationPhotoOcrAssetState());

		try {
			setAssetState(await getInstallationPhotoOcrAssetState());
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось проверить OCR-модель.");
		}
	}, []);

	useEffect(() => {
		if (!enabled) return;

		setSetupDismissed(readSetupDismissed());
		void refreshAssetState();
	}, [enabled, refreshAssetState, setSetupDismissed]);

	return { assetState, setAssetState, refreshAssetState };
}

function useSetupDismissal() {
	const [setupDismissed, setSetupDismissed] = useState(false);

	const dismissSetup = useCallback(() => {
		saveSetupDismissed();
		setSetupDismissed(true);
		toast.info("Позже: Канбан монтажа -> Фото монтажа -> Подготовить OCR.");
	}, [setSetupDismissed]);

	return { setupDismissed, setSetupDismissed, dismissSetup };
}

function usePhotoOcrAssetPreparation(setAssetState: Dispatch<SetStateAction<InstallationPhotoAssetState>>) {
	const [assetProgress, setAssetProgress] = useState<InstallationPhotoAssetProgress | null>(null);
	const [preparingAssets, setPreparingAssets] = useState(false);

	const prepareAssets = useCallback(async () => {
		setPreparingAssets(true);

		try {
			await warmInstallationPhotoOcrAssets(setAssetProgress);
			setAssetState(await getInstallationPhotoOcrAssetState());
			toast.success("OCR-модель скачана для offline-работы.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось скачать OCR-модель.");
		} finally {
			setPreparingAssets(false);
		}
	}, [setAssetState]);

	return { assetProgress, preparingAssets, prepareAssets };
}

export function useInstallationPhotoOcrAssets(enabled: boolean) {
	const { setupDismissed, setSetupDismissed, dismissSetup } = useSetupDismissal();
	const { assetState, setAssetState, refreshAssetState } = usePhotoOcrAssetState(enabled, setSetupDismissed);
	const { assetProgress, preparingAssets, prepareAssets } = usePhotoOcrAssetPreparation(setAssetState);

	return useMemo(
		() => ({
			assetProgress,
			assetState,
			preparingAssets,
			prepareAssets,
			refreshAssetState,
			dismissSetup,
			isReady: assetState.status === "ready",
			isChecking: assetState.status === "checking",
			shouldShowSetup:
				enabled &&
				(assetState.status === "missing" || assetState.status === "unsupported") &&
				!setupDismissed,
		}),
		[
			assetProgress,
			assetState,
			dismissSetup,
			enabled,
			prepareAssets,
			preparingAssets,
			refreshAssetState,
			setupDismissed,
		]
	);
}
