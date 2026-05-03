"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const photoMimeType = "image/jpeg";
const photoQuality = 0.92;

export type InstallationCameraStatus = "idle" | "starting" | "ready" | "unsupported" | "failed";

function stopMediaStream(stream: MediaStream | null) {
	stream?.getTracks().forEach((track) => track.stop());
}

function createCameraFileName() {
	return `installation-photo-${new Date().toISOString().replaceAll(":", "-")}.jpg`;
}

function createCameraConstraints() {
	return {
		audio: false,
		video: {
			facingMode: { ideal: "environment" },
		},
	} satisfies MediaStreamConstraints;
}

async function createFileFromCanvas(canvas: HTMLCanvasElement) {
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, photoMimeType, photoQuality)
	);

	if (!blob) {
		throw new Error("Не удалось сохранить снимок.");
	}

	return new File([blob], createCameraFileName(), { type: photoMimeType });
}

export function useInstallationCamera(open: boolean) {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const requestIdRef = useRef(0);
	const [status, setStatus] = useState<InstallationCameraStatus>("idle");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const startCamera = useCallback(async (requestId: number) => {
		if (!navigator.mediaDevices?.getUserMedia) {
			setStatus("unsupported");
			return;
		}

		setStatus("starting");
		setErrorMessage(null);

		try {
			const stream = await navigator.mediaDevices.getUserMedia(createCameraConstraints());

			if (requestId !== requestIdRef.current) {
				stopMediaStream(stream);
				return;
			}

			streamRef.current = stream;
			await attachStreamToVideo(streamRef.current, videoRef.current);
			setStatus("ready");
		} catch (error) {
			stopMediaStream(streamRef.current);
			streamRef.current = null;
			setStatus("failed");
			setErrorMessage(error instanceof Error ? error.message : "Камера недоступна.");
		}
	}, []);

	useEffect(() => {
		if (!open) {
			requestIdRef.current += 1;
			stopMediaStream(streamRef.current);
			streamRef.current = null;
			setStatus("idle");
			return;
		}

		const requestId = requestIdRef.current + 1;
		requestIdRef.current = requestId;
		void startCamera(requestId);

		return () => {
			requestIdRef.current += 1;
			stopMediaStream(streamRef.current);
		};
	}, [open, startCamera]);

	const capturePhoto = useCallback(async (): Promise<File> => {
		const video = videoRef.current;

		if (!video || status !== "ready") {
			throw new Error("Камера ещё не готова.");
		}

		const canvas = drawVideoFrame(video);
		return createFileFromCanvas(canvas);
	}, [status]);

	return { videoRef, status, errorMessage, capturePhoto };
}

async function attachStreamToVideo(stream: MediaStream, video: HTMLVideoElement | null) {
	if (!video) return;

	video.srcObject = stream;
	await video.play();
}

function drawVideoFrame(video: HTMLVideoElement) {
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");

	if (!context) {
		throw new Error("Canvas недоступен для снимка.");
	}

	canvas.width = video.videoWidth;
	canvas.height = video.videoHeight;
	context.drawImage(video, 0, 0, canvas.width, canvas.height);

	return canvas;
}
