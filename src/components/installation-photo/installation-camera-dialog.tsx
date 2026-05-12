"use client";

import { CameraIcon, XIcon } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useInstallationCamera } from "@/hooks/useInstallationCamera";

export function InstallationCameraDialog({
	open,
	onOpenChange,
	onCapture,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCapture: (files: File[]) => Promise<void>;
}) {
	const camera = useInstallationCamera(open);
	const canCapture = camera.status === "ready";
	const waitingForCamera = camera.status === "starting";

	async function handleCapture() {
		try {
			const file = await camera.capturePhoto();
			await onCapture([file]);
			onOpenChange(false);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось сделать снимок.");
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="h-[calc(100svh-2rem)] max-h-[720px] sm:max-w-xl" showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>Камера</DialogTitle>
					<DialogDescription>Наведите основную камеру на лист монтажа.</DialogDescription>
				</DialogHeader>
				<CameraPreview
					videoRef={camera.videoRef}
					waiting={waitingForCamera}
					errorMessage={getCameraErrorMessage(camera.status, camera.errorMessage)}
				/>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						<XIcon data-icon="inline-start" />
						Закрыть
					</Button>
					<Button type="button" disabled={!canCapture} onClick={() => void handleCapture()}>
						<CameraIcon data-icon="inline-start" />
						Снимок
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function CameraPreview({
	videoRef,
	waiting,
	errorMessage,
}: {
	videoRef: RefObject<HTMLVideoElement | null>;
	waiting: boolean;
	errorMessage: string | null;
}) {
	if (errorMessage) return <CameraPreviewFrame content={<CameraMessage message={errorMessage} />} />;
	if (waiting) return <CameraPreviewFrame content={<CameraLoading />} />;

	return (
		<div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted">
			<video
				ref={videoRef}
				className="h-full w-full object-contain"
				autoPlay
				muted
				playsInline
				aria-label="Предпросмотр основной камеры"
			/>
		</div>
	);
}

function CameraPreviewFrame({ content }: { content: ReactNode }) {
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border bg-muted">
			{content}
		</div>
	);
}

function CameraLoading() {
	return (
		<div className="flex items-center gap-2 text-sm text-muted-foreground">
			<Spinner />
			Открываем камеру
		</div>
	);
}

function CameraMessage({ message }: { message: string }) {
	return <div className="px-4 text-center text-sm text-muted-foreground">{message}</div>;
}

function getCameraErrorMessage(status: string, errorMessage: string | null) {
	if (status === "unsupported") return "Этот браузер не поддерживает доступ к камере.";
	if (status === "failed") return errorMessage ?? "Камера недоступна.";

	return null;
}
