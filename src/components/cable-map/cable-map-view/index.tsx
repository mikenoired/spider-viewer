"use client";

import { Link } from "@tanstack/react-router";
import {
	DownloadIcon,
	FileUpIcon,
	Layers2Icon,
	LoaderCircleIcon,
	MapIcon,
	Maximize2Icon,
	MinusIcon,
	Minimize2Icon,
	PercentIcon,
	PlusIcon,
	RefreshCcwIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useAppShellChrome } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { canUploadSnapshot, canViewAudit } from "@/lib/auth/shared";
import { downloadDailyHistoryDocx } from "@/lib/cable-map/functions";
import { buildDailyHistoryReportFileName } from "@/lib/cable-map/report-utils";
import type { DashboardData } from "@/lib/cable-map/shared";
import { cn, downloadResponseFile } from "@/lib/utils";

import { boardColumns, boardWidth } from "./config";
import { LevelBandView } from "./level-band-view";
import { LeftZoneHeader, MapTitle, PathHeader, RightZoneHeader, SummaryCard } from "./map-header";
import { BoardPathLayer } from "./path-layer";
import { buildBoardMetrics, buildLevelBands } from "./utils";

const MAP_ZOOM_MIN = 0.45;
const MAP_ZOOM_MAX = 1.6;
const MAP_ZOOM_STEP = 0.1;
const MAP_DRAG_THRESHOLD = 4;
const MAP_INERTIA_MIN_VELOCITY = 0.02;
const MAP_INERTIA_FRICTION = 0.92;
const MAP_WHEEL_ZOOM_SENSITIVITY = 0.0016;
const MAP_BUTTON_ZOOM_DURATION = 180;
const MAP_FULLSCREEN_EDGE_PADDING = 144;
const MAP_PAN_IGNORE_SELECTOR =
	"button, a, input, textarea, select, label, summary, [role='button'], [role='link'], [contenteditable='true'], [data-map-pan-ignore='true']";

type DragState = {
	pointerId: number;
	startX: number;
	startY: number;
	startOffsetX: number;
	startOffsetY: number;
	isDragging: boolean;
};

type PointerSnapshot = {
	clientX: number;
	clientY: number;
};

type PinchState = {
	pointerIds: [number, number];
	initialDistance: number;
	initialZoom: number;
	anchorContentX: number;
	anchorContentY: number;
};

type InertiaVelocity = {
	x: number;
	y: number;
};

type WheelZoomState = {
	deltaY: number;
	anchor: {
		clientX: number;
		clientY: number;
	};
};

function clampMapZoom(value: number) {
	return Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, Math.round(value * 100) / 100));
}

function isPanIgnoredTarget(target: EventTarget | null) {
	return target instanceof HTMLElement && target.closest(MAP_PAN_IGNORE_SELECTOR) !== null;
}

function suppressNextClick() {
	const handler = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		window.removeEventListener("click", handler, true);
	};

	window.addEventListener("click", handler, true);
	window.setTimeout(() => window.removeEventListener("click", handler, true), 250);
}

function getDistanceBetweenPointers(first: PointerSnapshot, second: PointerSnapshot) {
	return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

function getCenterBetweenPointers(first: PointerSnapshot, second: PointerSnapshot) {
	return {
		clientX: (first.clientX + second.clientX) / 2,
		clientY: (first.clientY + second.clientY) / 2,
	};
}

function FloatingContrastPanel({ className, children }: { className?: string; children: React.ReactNode }) {
	return (
		<div
			className={cn(
				"rounded-[1rem] border border-border/80 bg-background/88 shadow-lg backdrop-blur-md",
				className
			)}>
			{children}
		</div>
	);
}

function normalizeWheelDelta(
	event:
		| Pick<WheelEvent, "deltaMode" | "deltaY">
		| Pick<React.WheelEvent<HTMLDivElement>, "deltaMode" | "deltaY">,
	viewportHeight: number
) {
	if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
		return event.deltaY * 16;
	}

	if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
		return event.deltaY * viewportHeight;
	}

	return event.deltaY;
}

function startDailyReportExport(
	level: string | undefined,
	setExportingLevel: React.Dispatch<React.SetStateAction<string | null>>,
	setExportingDailyReport: React.Dispatch<React.SetStateAction<boolean>>
) {
	if (level) {
		setExportingLevel(level);
		return;
	}

	setExportingDailyReport(true);
}

function finishDailyReportExport(
	level: string | undefined,
	setExportingLevel: React.Dispatch<React.SetStateAction<string | null>>,
	setExportingDailyReport: React.Dispatch<React.SetStateAction<boolean>>
) {
	if (level) {
		setExportingLevel((current) => (current === level ? null : current));
		return;
	}

	setExportingDailyReport(false);
}

function getDailyReportExportErrorMessage(error: unknown, level?: string) {
	if (error instanceof Error) {
		return error.message;
	}

	return level ? `Не удалось выгрузить отчёт по уровню ${level}.` : "Не удалось выгрузить ежедневный отчёт.";
}

async function exportDailyReport(level?: string) {
	const fileName = buildDailyHistoryReportFileName(level);
	const response = await downloadDailyHistoryDocx({
		data: {
			fileName,
			level: level ?? null,
		},
	});

	if (!(response instanceof Response)) {
		throw new Error("Сервер вернул неожиданный ответ при экспорте.");
	}

	await downloadResponseFile(response, fileName);
}

export function CableMapView({
	data,
	canEditProgress,
	canManageManualRooms,
	role,
}: {
	data: DashboardData;
	canEditProgress: boolean;
	canManageManualRooms: boolean;
	role: "user" | "admin" | "super-admin";
}) {
	const { setChromeHidden } = useAppShellChrome();
	const workspaceRef = useRef<HTMLDivElement | null>(null);
	const viewportRef = useRef<HTMLDivElement | null>(null);
	const contentMeasureRef = useRef<HTMLDivElement | null>(null);
	const previousFocusedElementRef = useRef<HTMLElement | null>(null);
	const dragStateRef = useRef<DragState | null>(null);
	const offsetRef = useRef({ x: 0, y: 0 });
	const zoomRef = useRef(1);
	const activePointersRef = useRef(new Map<number, PointerSnapshot>());
	const pinchStateRef = useRef<PinchState | null>(null);
	const velocitySampleRef = useRef<{ time: number; scrollLeft: number; scrollTop: number } | null>(null);
	const inertiaVelocityRef = useRef<InertiaVelocity>({ x: 0, y: 0 });
	const inertiaFrameRef = useRef<number | null>(null);
	const wheelZoomFrameRef = useRef<number | null>(null);
	const zoomAnimationFrameRef = useRef<number | null>(null);
	const wheelZoomStateRef = useRef<WheelZoomState | null>(null);
	const didInitializeViewportRef = useRef(false);
	const [exportingDailyReport, setExportingDailyReport] = useState(false);
	const [exportingLevel, setExportingLevel] = useState<string | null>(null);
	const [zoom, setZoom] = useState(1);
	const [contentSize, setContentSize] = useState({ width: 0, height: 0 });
	const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
	const [offset, setOffset] = useState({ x: 0, y: 0 });
	const [workspaceHeight, setWorkspaceHeight] = useState(0);
	const [isDragging, setIsDragging] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [overlayLocks, setOverlayLocks] = useState<Record<string, boolean>>({});
	const canExportDailyReport = canViewAudit(role);
	const isOverlayOpen = Object.keys(overlayLocks).length > 0;
	const levelBands = useMemo(() => buildLevelBands(data.levels), [data.levels]);
	const boardMetrics = useMemo(() => buildBoardMetrics(levelBands), [levelBands]);
	const canvasSidePadding = isFullscreen ? MAP_FULLSCREEN_EDGE_PADDING : 32;
	const canvasTopPadding = isFullscreen ? MAP_FULLSCREEN_EDGE_PADDING : 16;
	const canvasBottomPadding = isFullscreen ? MAP_FULLSCREEN_EDGE_PADDING : 24;
	const contentWidth = boardWidth + canvasSidePadding * 2;
	const measuredContentWidth = Math.max(contentWidth, contentSize.width || contentWidth);

	const restoreDragSession = useCallback((pointerId?: number, suppressClick = false) => {
		const viewport = viewportRef.current;
		const dragState = dragStateRef.current;
		const capturePointerId = pointerId ?? dragState?.pointerId;

		if (
			viewport &&
			dragState &&
			capturePointerId !== undefined &&
			viewport.hasPointerCapture(capturePointerId)
		) {
			viewport.releasePointerCapture(capturePointerId);
		}

		dragStateRef.current = null;
		setIsDragging(false);
		document.body.style.removeProperty("cursor");
		document.body.style.removeProperty("user-select");
		document.body.style.removeProperty("-webkit-user-select");

		if (suppressClick) {
			suppressNextClick();
		}
	}, []);

	const handleOverlayOpenChange = useCallback((overlayId: string, open: boolean) => {
		setOverlayLocks((current) => {
			if (open) {
				return current[overlayId] ? current : { ...current, [overlayId]: true };
			}

			if (!(overlayId in current)) {
				return current;
			}

			const next = { ...current };
			delete next[overlayId];
			return next;
		});
	}, []);

	const cancelInertia = useCallback(() => {
		if (inertiaFrameRef.current !== null) {
			cancelAnimationFrame(inertiaFrameRef.current);
			inertiaFrameRef.current = null;
		}

		inertiaVelocityRef.current = { x: 0, y: 0 };
		velocitySampleRef.current = null;
	}, []);

	const cancelWheelZoomFrame = useCallback(() => {
		if (wheelZoomFrameRef.current !== null) {
			cancelAnimationFrame(wheelZoomFrameRef.current);
			wheelZoomFrameRef.current = null;
		}

		wheelZoomStateRef.current = null;
	}, []);

	const cancelZoomAnimation = useCallback(() => {
		if (zoomAnimationFrameRef.current !== null) {
			cancelAnimationFrame(zoomAnimationFrameRef.current);
			zoomAnimationFrameRef.current = null;
		}
	}, []);

	useEffect(() => {
		if (!contentMeasureRef.current) return;

		const element = contentMeasureRef.current;
		const updateSize = () =>
			setContentSize({
				width: Math.max(element.offsetWidth, element.scrollWidth, contentWidth),
				height: Math.max(element.offsetHeight, element.scrollHeight),
			});
		const resizeObserver = new ResizeObserver(updateSize);

		updateSize();
		resizeObserver.observe(element);

		return () => {
			resizeObserver.disconnect();
		};
	}, [data.snapshot, levelBands.length, contentWidth]);

	useEffect(() => {
		if (!viewportRef.current) return;

		const element = viewportRef.current;
		const updateSize = () =>
			setViewportSize({
				width: element.clientWidth,
				height: element.clientHeight,
			});
		const resizeObserver = new ResizeObserver(updateSize);

		updateSize();
		resizeObserver.observe(element);

		return () => {
			resizeObserver.disconnect();
		};
	}, [isFullscreen]);

	useEffect(() => {
		if (!workspaceRef.current) {
			return;
		}

		const element = workspaceRef.current;
		const updateSize = () => setWorkspaceHeight(element.offsetHeight);
		const resizeObserver = new ResizeObserver(updateSize);

		updateSize();
		resizeObserver.observe(element);

		return () => {
			resizeObserver.disconnect();
		};
	}, []);

	useEffect(() => {
		const viewport = viewportRef.current;

		if (!viewport) {
			return;
		}

		const preventBrowserZoom = (event: WheelEvent) => {
			if (event.ctrlKey) {
				event.preventDefault();
			}
		};

		const preventSafariGestureZoom = (event: Event) => {
			event.preventDefault();
		};

		viewport.addEventListener("wheel", preventBrowserZoom, { passive: false });
		viewport.addEventListener("gesturestart", preventSafariGestureZoom, { passive: false });
		viewport.addEventListener("gesturechange", preventSafariGestureZoom, { passive: false });

		return () => {
			viewport.removeEventListener("wheel", preventBrowserZoom);
			viewport.removeEventListener("gesturestart", preventSafariGestureZoom);
			viewport.removeEventListener("gesturechange", preventSafariGestureZoom);
		};
	}, [data.snapshot]);

	useEffect(() => {
		didInitializeViewportRef.current = false;
	}, [data.snapshot]);

	useEffect(() => {
		zoomRef.current = zoom;
	}, [zoom]);

	useEffect(() => {
		offsetRef.current = offset;
	}, [offset]);

	useEffect(() => () => restoreDragSession(undefined, false), [restoreDragSession]);
	useEffect(
		() => () => {
			cancelInertia();
			cancelWheelZoomFrame();
			cancelZoomAnimation();
			activePointersRef.current.clear();
			pinchStateRef.current = null;
		},
		[cancelInertia, cancelWheelZoomFrame, cancelZoomAnimation]
	);

	useEffect(() => {
		if (!isOverlayOpen) {
			return;
		}

		cancelInertia();
		cancelWheelZoomFrame();
		cancelZoomAnimation();
		activePointersRef.current.clear();
		pinchStateRef.current = null;
		restoreDragSession(undefined, false);
	}, [cancelInertia, cancelWheelZoomFrame, cancelZoomAnimation, isOverlayOpen, restoreDragSession]);

	useEffect(() => {
		setChromeHidden(isFullscreen);

		const previousOverflow = document.body.style.overflow;
		const previousOverscrollBehavior = document.body.style.overscrollBehavior;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setIsFullscreen(false);
			}
		};

		if (isFullscreen) {
			previousFocusedElementRef.current =
				document.activeElement instanceof HTMLElement ? document.activeElement : null;
			document.body.style.overflow = "hidden";
			document.body.style.overscrollBehavior = "none";
			window.addEventListener("keydown", handleKeyDown);
			requestAnimationFrame(() => workspaceRef.current?.focus());
		}

		return () => {
			setChromeHidden(false);
			document.body.style.overflow = previousOverflow;
			document.body.style.overscrollBehavior = previousOverscrollBehavior;
			window.removeEventListener("keydown", handleKeyDown);

			if (isFullscreen) {
				previousFocusedElementRef.current?.focus();
				previousFocusedElementRef.current = null;
			}
		};
	}, [isFullscreen, setChromeHidden]);

	const clampOffset = useCallback(
		(nextX: number, nextY: number, scale: number) => {
			const scaledWidth = measuredContentWidth * scale;
			const scaledHeight = contentSize.height * scale;
			const minX = Math.min(0, viewportSize.width - scaledWidth);
			const minY = Math.min(0, viewportSize.height - scaledHeight);

			return {
				x: Math.min(0, Math.max(minX, nextX)),
				y: Math.min(0, Math.max(minY, nextY)),
			};
		},
		[contentSize.height, measuredContentWidth, viewportSize.height, viewportSize.width]
	);

	const applyZoom = useCallback(
		(
			nextZoom: number,
			anchor?: { clientX: number; clientY: number; contentX?: number; contentY?: number }
		) => {
			const clampedZoom = clampMapZoom(nextZoom);
			const viewport = viewportRef.current;

			cancelInertia();
			cancelWheelZoomFrame();
			cancelZoomAnimation();

			setZoom((currentZoom) => {
				if (Math.abs(currentZoom - clampedZoom) < 0.001) {
					return currentZoom;
				}

				if (!viewport) {
					return clampedZoom;
				}

				const viewportRect = viewport.getBoundingClientRect();
				const anchorOffsetX = anchor ? anchor.clientX - viewportRect.left : viewport.clientWidth / 2;
				const anchorOffsetY = anchor ? anchor.clientY - viewportRect.top : viewport.clientHeight / 2;
				const currentOffset = offsetRef.current;
				const anchorX = anchor?.contentX ?? (anchorOffsetX - currentOffset.x) / currentZoom;
				const anchorY = anchor?.contentY ?? (anchorOffsetY - currentOffset.y) / currentZoom;
				setOffset(
					clampOffset(
						anchorOffsetX - anchorX * clampedZoom,
						anchorOffsetY - anchorY * clampedZoom,
						clampedZoom
					)
				);

				return clampedZoom;
			});
		},
		[cancelInertia, cancelWheelZoomFrame, cancelZoomAnimation, clampOffset]
	);

	const animateZoomTo = useCallback(
		(nextZoom: number) => {
			const viewport = viewportRef.current;
			const targetZoom = clampMapZoom(nextZoom);

			if (!viewport || Math.abs(targetZoom - zoomRef.current) < 0.001) {
				return;
			}

			cancelInertia();
			cancelWheelZoomFrame();
			cancelZoomAnimation();

			const startZoom = zoomRef.current;
			const startOffset = offsetRef.current;
			const anchorOffsetX = viewport.clientWidth / 2;
			const anchorOffsetY = viewport.clientHeight / 2;
			const anchorContentX = (anchorOffsetX - startOffset.x) / startZoom;
			const anchorContentY = (anchorOffsetY - startOffset.y) / startZoom;
			const startTime = performance.now();
			const easeOut = (value: number) => 1 - Math.pow(1 - value, 3);

			const step = (timestamp: number) => {
				const elapsed = timestamp - startTime;
				const progress = Math.min(1, elapsed / MAP_BUTTON_ZOOM_DURATION);
				const easedProgress = easeOut(progress);
				const currentZoom = startZoom + (targetZoom - startZoom) * easedProgress;
				const nextOffset = clampOffset(
					anchorOffsetX - anchorContentX * currentZoom,
					anchorOffsetY - anchorContentY * currentZoom,
					currentZoom
				);

				setZoom(currentZoom);
				setOffset(nextOffset);

				if (progress < 1) {
					zoomAnimationFrameRef.current = requestAnimationFrame(step);
					return;
				}

				zoomAnimationFrameRef.current = null;
				setZoom(targetZoom);
				setOffset(
					clampOffset(
						anchorOffsetX - anchorContentX * targetZoom,
						anchorOffsetY - anchorContentY * targetZoom,
						targetZoom
					)
				);
			};

			zoomAnimationFrameRef.current = requestAnimationFrame(step);
		},
		[cancelInertia, cancelWheelZoomFrame, cancelZoomAnimation, clampOffset]
	);

	const startInertia = useCallback(
		(initialVelocity: InertiaVelocity) => {
			if (!viewportRef.current) {
				return;
			}

			cancelInertia();
			cancelZoomAnimation();
			inertiaVelocityRef.current = initialVelocity;
			let lastTimestamp = performance.now();

			const step = (timestamp: number) => {
				if (!viewportRef.current) {
					inertiaFrameRef.current = null;
					return;
				}

				const deltaTime = Math.min(34, timestamp - lastTimestamp || 16.67);
				lastTimestamp = timestamp;
				const decay = Math.pow(MAP_INERTIA_FRICTION, deltaTime / 16.67);
				let nextVelocityX = inertiaVelocityRef.current.x * decay;
				let nextVelocityY = inertiaVelocityRef.current.y * decay;

				if (
					Math.abs(nextVelocityX) < MAP_INERTIA_MIN_VELOCITY &&
					Math.abs(nextVelocityY) < MAP_INERTIA_MIN_VELOCITY
				) {
					cancelInertia();
					return;
				}

				const previousOffset = offsetRef.current;
				const nextOffset = clampOffset(
					previousOffset.x + nextVelocityX * deltaTime,
					previousOffset.y + nextVelocityY * deltaTime,
					zoomRef.current
				);

				setOffset(nextOffset);

				if (Math.abs(nextOffset.x - previousOffset.x) < 0.5) {
					nextVelocityX = 0;
				}

				if (Math.abs(nextOffset.y - previousOffset.y) < 0.5) {
					nextVelocityY = 0;
				}

				inertiaVelocityRef.current = {
					x: nextVelocityX,
					y: nextVelocityY,
				};

				if (
					Math.abs(nextVelocityX) < MAP_INERTIA_MIN_VELOCITY &&
					Math.abs(nextVelocityY) < MAP_INERTIA_MIN_VELOCITY
				) {
					cancelInertia();
					return;
				}

				inertiaFrameRef.current = requestAnimationFrame(step);
			};

			inertiaFrameRef.current = requestAnimationFrame(step);
		},
		[cancelInertia, cancelZoomAnimation, clampOffset]
	);

	const fitMapToViewport = useCallback(() => {
		const viewport = viewportRef.current;

		if (!viewport) {
			return;
		}

		const availableWidth = Math.max(0, viewport.clientWidth - 24);
		const nextZoom = clampMapZoom(Math.min(1, availableWidth / measuredContentWidth));
		setZoom(nextZoom);
		setOffset(clampOffset(0, 0, nextZoom));
	}, [clampOffset, measuredContentWidth]);

	useEffect(() => {
		const viewport = viewportRef.current;

		if (!viewport || contentSize.height <= 0 || viewportSize.width <= 0 || didInitializeViewportRef.current) {
			return;
		}

		didInitializeViewportRef.current = true;
		const availableWidth = Math.max(0, viewport.clientWidth - 24);
		const initialZoom = clampMapZoom(Math.min(1, availableWidth / measuredContentWidth));

		setZoom(initialZoom);
		setOffset(clampOffset(0, 0, initialZoom));
	}, [clampOffset, contentSize.height, measuredContentWidth, viewportSize.width]);

	useEffect(() => {
		if (contentSize.height <= 0 || viewportSize.width <= 0) {
			return;
		}

		setOffset((current) => {
			const next = clampOffset(current.x, current.y, zoomRef.current);

			if (next.x === current.x && next.y === current.y) {
				return current;
			}

			return next;
		});
	}, [clampOffset, contentSize.height, viewportSize.height, viewportSize.width]);

	const handleViewportPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (isOverlayOpen) {
				return;
			}

			cancelInertia();
			cancelZoomAnimation();

			if (event.pointerType === "touch") {
				activePointersRef.current.set(event.pointerId, {
					clientX: event.clientX,
					clientY: event.clientY,
				});
			}

			if (event.pointerType === "touch" && activePointersRef.current.size >= 2 && viewportRef.current) {
				const pointers = [...activePointersRef.current.entries()].slice(0, 2);
				const first = pointers[0]?.[1];
				const second = pointers[1]?.[1];

				if (first && second) {
					const center = getCenterBetweenPointers(first, second);
					const viewportRect = viewportRef.current.getBoundingClientRect();
					const centerOffsetX = center.clientX - viewportRect.left;
					const centerOffsetY = center.clientY - viewportRect.top;

					pinchStateRef.current = {
						pointerIds: [pointers[0][0], pointers[1][0]],
						initialDistance: Math.max(getDistanceBetweenPointers(first, second), 1),
						initialZoom: zoom,
						anchorContentX: (centerOffsetX - offsetRef.current.x) / zoom,
						anchorContentY: (centerOffsetY - offsetRef.current.y) / zoom,
					};
					restoreDragSession(undefined, false);
				}
			}

			if (
				!event.isPrimary ||
				event.button !== 0 ||
				!viewportRef.current ||
				isPanIgnoredTarget(event.target)
			) {
				return;
			}

			dragStateRef.current = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				startOffsetX: offsetRef.current.x,
				startOffsetY: offsetRef.current.y,
				isDragging: false,
			};

			viewportRef.current.setPointerCapture(event.pointerId);
			velocitySampleRef.current = {
				time: performance.now(),
				scrollLeft: offsetRef.current.x,
				scrollTop: offsetRef.current.y,
			};
			inertiaVelocityRef.current = { x: 0, y: 0 };
		},
		[cancelInertia, cancelZoomAnimation, isOverlayOpen, restoreDragSession, zoom]
	);

	const handleViewportPointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (isOverlayOpen) {
				return;
			}

			const viewport = viewportRef.current;
			const dragState = dragStateRef.current;

			if (event.pointerType === "touch" && activePointersRef.current.has(event.pointerId)) {
				activePointersRef.current.set(event.pointerId, {
					clientX: event.clientX,
					clientY: event.clientY,
				});
			}

			const pinchState = pinchStateRef.current;

			if (viewport && pinchState) {
				const first = activePointersRef.current.get(pinchState.pointerIds[0]);
				const second = activePointersRef.current.get(pinchState.pointerIds[1]);

				if (first && second) {
					const center = getCenterBetweenPointers(first, second);
					const distance = Math.max(getDistanceBetweenPointers(first, second), 1);
					const nextZoom = pinchState.initialZoom * (distance / pinchState.initialDistance);

					applyZoom(nextZoom, {
						clientX: center.clientX,
						clientY: center.clientY,
						contentX: pinchState.anchorContentX,
						contentY: pinchState.anchorContentY,
					});
					event.preventDefault();
				}

				return;
			}

			if (!viewport || !dragState || dragState.pointerId !== event.pointerId) {
				return;
			}

			const deltaX = event.clientX - dragState.startX;
			const deltaY = event.clientY - dragState.startY;

			if (!dragState.isDragging && Math.hypot(deltaX, deltaY) < MAP_DRAG_THRESHOLD) {
				return;
			}

			if (!dragState.isDragging) {
				dragState.isDragging = true;
				setIsDragging(true);
				document.body.style.cursor = "grabbing";
				document.body.style.userSelect = "none";
				document.body.style.setProperty("-webkit-user-select", "none");
			}

			const nextOffset = clampOffset(
				dragState.startOffsetX + deltaX,
				dragState.startOffsetY + deltaY,
				zoomRef.current
			);

			setOffset(nextOffset);

			const now = performance.now();
			const lastSample = velocitySampleRef.current;

			if (lastSample) {
				const deltaTime = Math.max(now - lastSample.time, 1);
				const instantVelocityX = (nextOffset.x - lastSample.scrollLeft) / deltaTime;
				const instantVelocityY = (nextOffset.y - lastSample.scrollTop) / deltaTime;

				inertiaVelocityRef.current = {
					x: inertiaVelocityRef.current.x * 0.75 + instantVelocityX * 0.25,
					y: inertiaVelocityRef.current.y * 0.75 + instantVelocityY * 0.25,
				};
			}

			velocitySampleRef.current = {
				time: now,
				scrollLeft: nextOffset.x,
				scrollTop: nextOffset.y,
			};
			event.preventDefault();
		},
		[applyZoom, clampOffset, isOverlayOpen]
	);

	const handleViewportPointerUp = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			activePointersRef.current.delete(event.pointerId);

			if (pinchStateRef.current) {
				const pinchState = pinchStateRef.current;

				if (pinchState.pointerIds.includes(event.pointerId)) {
					pinchStateRef.current = null;
					velocitySampleRef.current = null;
					inertiaVelocityRef.current = { x: 0, y: 0 };
				}

				return;
			}

			const dragState = dragStateRef.current;

			if (!dragState || dragState.pointerId !== event.pointerId) {
				return;
			}

			const nextVelocity = inertiaVelocityRef.current;
			restoreDragSession(event.pointerId, dragState.isDragging);

			if (dragState.isDragging) {
				startInertia(nextVelocity);
			}
		},
		[restoreDragSession, startInertia]
	);

	const handleViewportPointerCancel = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			activePointersRef.current.delete(event.pointerId);

			if (pinchStateRef.current?.pointerIds.includes(event.pointerId)) {
				pinchStateRef.current = null;
			}

			const dragState = dragStateRef.current;

			if (!dragState || dragState.pointerId !== event.pointerId) {
				return;
			}

			restoreDragSession(event.pointerId, false);
		},
		[restoreDragSession]
	);

	const handleViewportLostPointerCapture = useCallback(() => {
		if (dragStateRef.current) {
			restoreDragSession(undefined, false);
		}
		activePointersRef.current.clear();
		pinchStateRef.current = null;
	}, [restoreDragSession]);

	const handleViewportWheel = useCallback(
		(event: React.WheelEvent<HTMLDivElement>) => {
			if (isOverlayOpen) {
				return;
			}

			if (!event.ctrlKey) {
				return;
			}

			event.preventDefault();

			const viewport = viewportRef.current;

			if (!viewport) {
				return;
			}

			const normalizedDelta = normalizeWheelDelta(event, viewport.clientHeight);
			const previousState = wheelZoomStateRef.current;

			wheelZoomStateRef.current = {
				deltaY: (previousState?.deltaY ?? 0) + normalizedDelta,
				anchor: {
					clientX: event.clientX,
					clientY: event.clientY,
				},
			};

			if (wheelZoomFrameRef.current !== null) {
				return;
			}

			wheelZoomFrameRef.current = requestAnimationFrame(() => {
				wheelZoomFrameRef.current = null;
				const pendingState = wheelZoomStateRef.current;

				if (!pendingState) {
					return;
				}

				wheelZoomStateRef.current = null;
				const nextZoom = zoomRef.current * Math.exp(-pendingState.deltaY * MAP_WHEEL_ZOOM_SENSITIVITY);

				applyZoom(nextZoom, pendingState.anchor);
			});
		},
		[applyZoom, isOverlayOpen]
	);

	const handleDailyReportExport = useCallback(
		async (level?: string) => {
			if (!canExportDailyReport) {
				return;
			}

			startDailyReportExport(level, setExportingLevel, setExportingDailyReport);

			try {
				await exportDailyReport(level);
			} catch (error) {
				toast.error(getDailyReportExportErrorMessage(error, level));
			} finally {
				finishDailyReportExport(level, setExportingLevel, setExportingDailyReport);
			}
		},
		[canExportDailyReport]
	);

	if (!data.snapshot) {
		return (
			<Card className="border-dashed">
				<CardHeader>
					<CardTitle>Активный граф пока не загружен</CardTitle>
					<CardDescription>
						Сначала нужно импортировать файл с листом {'"Общ"'}, после чего появится интерактивная карта
						демонтажа.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-wrap items-center gap-3">
					<Badge variant="secondary">Ожидание данных</Badge>
					{canUploadSnapshot(role) ? (
						<Link
							to="/app/import"
							className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition hover:bg-muted">
							<FileUpIcon />
							Перейти к загрузке
						</Link>
					) : null}
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="flex min-w-0 flex-1 flex-col gap-4">
			<div className="grid gap-4 px-4 pt-4 md:grid-cols-2 xl:grid-cols-4">
				<SummaryCard
					title="Активный снимок"
					value={data.snapshot.fileName}
					description={`Загружено строк: ${data.snapshot.rowCount}`}
					icon={<MapIcon />}
				/>
				<SummaryCard
					title="Отметки"
					value={String(data.snapshot.levelCount)}
					description={`Групп на карте: ${data.snapshot.groupCount}`}
					icon={<Layers2Icon />}
				/>
				<SummaryCard
					title="Помещения"
					value={String(data.snapshot.roomCount)}
					description={`Импортировал: ${data.snapshot.importedByLogin}`}
					icon={<PercentIcon />}
				/>
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium text-muted-foreground">Общий прогресс</CardTitle>
						<CardDescription className="text-3xl font-semibold text-foreground">
							{data.snapshot.averageProgress}%
						</CardDescription>
					</CardHeader>
					<CardContent className="pt-0">
						<Progress value={data.snapshot.averageProgress} />
					</CardContent>
				</Card>
			</div>

			<div
				className="px-4 pb-4"
				style={isFullscreen && workspaceHeight > 0 ? { minHeight: workspaceHeight } : undefined}>
				<AnimatePresence>
					{isFullscreen ? (
						<motion.div
							key="map-backdrop"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
							className="fixed inset-0 z-[80] bg-background/72 backdrop-blur-md"
						/>
					) : null}
				</AnimatePresence>

				<motion.div
					layout
					ref={workspaceRef}
					transition={{ layout: { duration: 0.34, ease: [0.23, 1, 0.32, 1] } }}
					role={isFullscreen ? "dialog" : undefined}
					aria-modal={isFullscreen ? true : undefined}
					aria-label={isFullscreen ? "Полноэкранная карта демонтажа" : undefined}
					tabIndex={isFullscreen ? -1 : undefined}
					className={cn(
						"relative overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm",
						isFullscreen &&
							"fixed inset-0 z-[90] flex rounded-none border-none bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-none"
					)}>
					{!isFullscreen ? (
						<div className="border-b border-border/70 px-4 py-3">
							<div className="flex flex-wrap items-center justify-between gap-3">
								<div className="min-w-0">
									<div className="text-sm font-semibold text-foreground">Интерактивная карта демонтажа</div>
									<div className="text-sm text-muted-foreground">
										Перетягивайте карту в любом направлении, масштабируйте сцену и разворачивайте ее на весь
										экран.
									</div>
								</div>

								<div className="flex flex-wrap items-center gap-2">
									<div className="flex items-center gap-1 rounded-full border border-border/80 bg-background/90 p-1 shadow-sm">
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											data-map-pan-ignore="true"
											onClick={() => animateZoomTo(zoom - MAP_ZOOM_STEP)}
											disabled={zoom <= MAP_ZOOM_MIN}
											aria-label="Уменьшить карту">
											<MinusIcon />
										</Button>
										<div className="min-w-14 px-2 text-center text-sm font-semibold tabular-nums text-foreground select-none">
											{Math.round(zoom * 100)}%
										</div>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											data-map-pan-ignore="true"
											onClick={() => animateZoomTo(zoom + MAP_ZOOM_STEP)}
											disabled={zoom >= MAP_ZOOM_MAX}
											aria-label="Увеличить карту">
											<PlusIcon />
										</Button>
									</div>

									<Button
										type="button"
										variant="outline"
										data-map-pan-ignore="true"
										onClick={fitMapToViewport}>
										По ширине
									</Button>

									<Button
										type="button"
										variant="outline"
										data-map-pan-ignore="true"
										onClick={() => animateZoomTo(1)}
										disabled={Math.abs(zoom - 1) < 0.001}>
										<RefreshCcwIcon data-icon="inline-start" />
										100%
									</Button>

									{canExportDailyReport ? (
										<Button
											type="button"
											variant="outline"
											data-map-pan-ignore="true"
											onClick={() => void handleDailyReportExport()}
											disabled={exportingDailyReport || exportingLevel !== null}>
											{exportingDailyReport ? (
												<LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
											) : (
												<DownloadIcon data-icon="inline-start" />
											)}
											Выгрузить DOCX за день
										</Button>
									) : null}

									<Button
										type="button"
										variant="outline"
										data-map-pan-ignore="true"
										onClick={() => setIsFullscreen(true)}>
										<Maximize2Icon data-icon="inline-start" />
										На весь экран
									</Button>
								</div>
							</div>
						</div>
					) : null}

					<AnimatePresence>
						{isFullscreen ? (
							<>
								<motion.div
									initial={{ opacity: 0, x: -24, scale: 0.96 }}
									animate={{ opacity: 1, x: 0, scale: 1 }}
									exit={{ opacity: 0, x: -18, scale: 0.98 }}
									transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
									className="pointer-events-none absolute top-4 left-4 z-[95] flex max-w-[calc(100vw-2rem)] flex-col gap-3 sm:top-6 sm:left-6">
									<FloatingContrastPanel className="pointer-events-auto p-2">
										<Button
											type="button"
											variant="ghost"
											data-map-pan-ignore="true"
											onClick={() => setIsFullscreen(false)}
											className="h-11 rounded-[0.95rem] px-4 shadow-none">
											<Minimize2Icon data-icon="inline-start" />
											Свернуть
										</Button>
									</FloatingContrastPanel>
								</motion.div>

								<motion.div
									initial={{ opacity: 0, y: -18, scale: 0.96 }}
									animate={{ opacity: 1, y: 0, scale: 1 }}
									exit={{ opacity: 0, y: -14, scale: 0.98 }}
									transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1], delay: 0.02 }}
									className="pointer-events-none absolute top-4 right-4 z-[95] flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2 sm:top-6 sm:right-6">
									<FloatingContrastPanel className="pointer-events-auto p-2">
										<div className="flex items-center gap-1 rounded-[1rem]">
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												data-map-pan-ignore="true"
												onClick={() => animateZoomTo(zoom - MAP_ZOOM_STEP)}
												disabled={zoom <= MAP_ZOOM_MIN}
												aria-label="Уменьшить карту">
												<MinusIcon />
											</Button>
											<div className="min-w-16 px-2 text-center text-sm font-semibold tabular-nums text-foreground select-none">
												{Math.round(zoom * 100)}%
											</div>
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												data-map-pan-ignore="true"
												onClick={() => animateZoomTo(zoom + MAP_ZOOM_STEP)}
												disabled={zoom >= MAP_ZOOM_MAX}
												aria-label="Увеличить карту">
												<PlusIcon />
											</Button>
										</div>
									</FloatingContrastPanel>

									<FloatingContrastPanel className="pointer-events-auto p-2">
										<div className="flex flex-wrap items-center justify-end gap-2">
											<Button
												type="button"
												variant="ghost"
												data-map-pan-ignore="true"
												onClick={fitMapToViewport}>
												По ширине
											</Button>
											<Button
												type="button"
												variant="ghost"
												data-map-pan-ignore="true"
												onClick={() => animateZoomTo(1)}
												disabled={Math.abs(zoom - 1) < 0.001}>
												<RefreshCcwIcon data-icon="inline-start" />
												100%
											</Button>
										</div>
									</FloatingContrastPanel>
								</motion.div>

								<motion.div
									initial={{ opacity: 0, y: 18, scale: 0.96 }}
									animate={{ opacity: 1, y: 0, scale: 1 }}
									exit={{ opacity: 0, y: 14, scale: 0.98 }}
									transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1], delay: 0.04 }}
									className="pointer-events-none absolute right-4 bottom-4 z-[95] flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2 sm:right-6 sm:bottom-6">
									{canExportDailyReport ? (
										<FloatingContrastPanel className="pointer-events-auto p-2">
											<Button
												type="button"
												variant="ghost"
												data-map-pan-ignore="true"
												onClick={() => void handleDailyReportExport()}
												disabled={exportingDailyReport || exportingLevel !== null}>
												{exportingDailyReport ? (
													<LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
												) : (
													<DownloadIcon data-icon="inline-start" />
												)}
												Выгрузить DOCX за день
											</Button>
										</FloatingContrastPanel>
									) : null}
								</motion.div>
							</>
						) : null}
					</AnimatePresence>

					<div className="min-h-0 flex-1">
						<div
							ref={viewportRef}
							onWheel={handleViewportWheel}
							onPointerDown={handleViewportPointerDown}
							onPointerMove={handleViewportPointerMove}
							onPointerUp={handleViewportPointerUp}
							onPointerCancel={handleViewportPointerCancel}
							onLostPointerCapture={handleViewportLostPointerCapture}
							className={cn(
								"relative overflow-hidden overscroll-contain bg-background touch-none",
								isFullscreen ? "h-full min-h-0" : "h-[min(72vh,48rem)] min-h-[26rem]",
								isOverlayOpen ? "cursor-default" : isDragging ? "cursor-grabbing" : "cursor-grab"
							)}>
							<div
								ref={contentMeasureRef}
								className="absolute top-0 left-0 origin-top-left will-change-transform"
								style={{
									minWidth: contentWidth,
									transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
									transformOrigin: "top left",
								}}>
								<div
									className="space-y-5"
									style={{
										paddingTop: canvasTopPadding,
										paddingRight: canvasSidePadding,
										paddingBottom: canvasBottomPadding,
										paddingLeft: canvasSidePadding,
									}}>
									<MapTitle />

									<div className="border-b-2 border-dashed border-zinc-400/90 pb-3 pt-6 dark:border-zinc-700">
										<div
											className="grid items-center"
											style={{
												gridTemplateColumns: boardColumns,
											}}>
											<LeftZoneHeader />
											<div />
											<PathHeader side="dirty" />
											<span className="pb-1 text-center text-base font-semibold text-zinc-900 dark:text-zinc-100 select-none">
												Отметка
											</span>
											<PathHeader side="clean" />
											<div />
											<RightZoneHeader />
										</div>
									</div>

									<div className="relative overflow-hidden">
										<BoardPathLayer metrics={boardMetrics} />
										<div className="relative z-10">
											{levelBands.map((band, index) => (
												<LevelBandView
													key={`${band.level}:${band.levelOrder}`}
													band={band}
													bandIndex={index}
													canEditProgress={canEditProgress}
													canManageManualRooms={canManageManualRooms}
													onOverlayOpenChange={handleOverlayOpenChange}
													canExportDailyReport={canExportDailyReport}
													isExportDisabled={exportingDailyReport || exportingLevel !== null}
													isExportingReport={exportingLevel === band.level}
													onExportDailyReport={handleDailyReportExport}
													isLast={index === levelBands.length - 1}
												/>
											))}
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				</motion.div>
			</div>
		</div>
	);
}
