"use client";

import { DownloadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type {
	InstallationPhotoAssetProgress,
	InstallationPhotoAssetState,
} from "@/lib/installation-photo/assets";

export function InstallationPhotoOcrSetup({
	assetState,
	assetProgress,
	preparingAssets,
	onPrepareAssets,
	onDismiss,
}: {
	assetState: InstallationPhotoAssetState;
	assetProgress: InstallationPhotoAssetProgress | null;
	preparingAssets: boolean;
	onPrepareAssets: () => Promise<void>;
	onDismiss: () => void;
}) {
	const progress = assetProgress?.percent ?? getAssetStatePercent(assetState);
	const canPrepare = assetState.status !== "unsupported";

	return (
		<div className="flex">
			<Card className="w-full" size="sm">
				<CardHeader>
					<CardTitle>Подготовьте OCR для офлайн-работы</CardTitle>
					<CardDescription>
						Чтобы отмечать монтаж по фото без интернета, один раз скачайте модель на это устройство.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-3">
					<div className="text-sm text-muted-foreground">{getSetupDescription(assetState.status)}</div>
					<Progress value={progress} />
					<div className="text-xs text-muted-foreground">
						Загружено {assetState.loaded} из {assetState.total} файлов OCR.
					</div>
				</CardContent>
				<CardFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<Button type="button" variant="outline" disabled={preparingAssets} onClick={onDismiss}>
						Продолжить без фото
					</Button>
					<Button
						type="button"
						disabled={preparingAssets || !canPrepare}
						onClick={() => void onPrepareAssets()}>
						<DownloadIcon data-icon="inline-start" />
						Скачать OCR
					</Button>
				</CardFooter>
			</Card>
		</div>
	);
}

function getSetupDescription(status: InstallationPhotoAssetState["status"]) {
	if (status === "unsupported") {
		return "Браузер не поддерживает офлайн-кэш, поэтому добавление фото будет недоступно.";
	}

	return "Пока модель не скачана, добавление фото в канбан отключено.";
}

function getAssetStatePercent(assetState: InstallationPhotoAssetState) {
	if (assetState.total === 0) return 0;

	return Math.round((assetState.loaded / assetState.total) * 100);
}
