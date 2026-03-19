"use client";

import { Link } from "@tanstack/react-router";
import { FileUpIcon, Layers2Icon, MapIcon, PercentIcon } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { canUploadSnapshot } from "@/lib/auth/shared";
import type { DashboardData } from "@/lib/cable-map/shared";
import { boardColumns, boardWidth } from "./config";
import { LevelBandView } from "./level-band-view";
import {
	LeftZoneHeader,
	MapTitle,
	PathHeader,
	RightZoneHeader,
	SummaryCard,
} from "./map-header";
import { BoardPathLayer } from "./path-layer";
import { buildLevelBands } from "./utils";

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
	const titleScrollRef = useRef<HTMLDivElement | null>(null);
	const headerScrollRef = useRef<HTMLDivElement | null>(null);
	const bodyScrollRef = useRef<HTMLDivElement | null>(null);
	const activeScrollSourceRef = useRef<"title" | "header" | "body" | null>(
		null,
	);
	const releaseScrollLockFrameRef = useRef<number | null>(null);

	const syncScroll = useCallback((source: "title" | "header" | "body") => {
		if (
			activeScrollSourceRef.current &&
			activeScrollSourceRef.current !== source
		) {
			return;
		}

		const refs = [
			["title", titleScrollRef],
			["header", headerScrollRef],
			["body", bodyScrollRef],
		] as const;
		const sourceElement = refs.find(([key]) => key === source)?.[1].current;

		if (!sourceElement) return;

		activeScrollSourceRef.current = source;

		for (const [key, ref] of refs) {
			if (key === source || !ref.current) continue;
			if (Math.abs(ref.current.scrollLeft - sourceElement.scrollLeft) < 1)
				continue;

			ref.current.scrollLeft = sourceElement.scrollLeft;
		}

		if (releaseScrollLockFrameRef.current !== null) {
			cancelAnimationFrame(releaseScrollLockFrameRef.current);
		}

		releaseScrollLockFrameRef.current = requestAnimationFrame(() => {
			activeScrollSourceRef.current = null;
			releaseScrollLockFrameRef.current = null;
		});
	}, []);

	useEffect(() => {
		if (!data.snapshot || !bodyScrollRef.current) return;

		syncScroll("body");

		return () => {
			if (releaseScrollLockFrameRef.current) {
				cancelAnimationFrame(releaseScrollLockFrameRef.current);
			}
		};
	}, [data.snapshot, syncScroll]);

	if (!data.snapshot) {
		return (
			<Card className="border-dashed">
				<CardHeader>
					<CardTitle>Активный граф пока не загружен</CardTitle>
					<CardDescription>
						Сначала нужно импортировать файл с листом {'"Общ"'}, после чего
						появится интерактивная карта демонтажа.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-wrap items-center gap-3">
					<Badge variant="secondary">Ожидание данных</Badge>
					{canUploadSnapshot(role) ? (
						<Link
							to="/app/import"
							className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition hover:bg-muted"
						>
							<FileUpIcon />
							Перейти к загрузке
						</Link>
					) : null}
				</CardContent>
			</Card>
		);
	}

	const levelBands = buildLevelBands(data.levels);
	const mapCanvasWidth = boardWidth + 16;

	return (
		<div className="flex flex-1 flex-col gap-4">
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 px-4 pt-4">
				<SummaryCard
					title="Активный снимок"
					value={data.snapshot.fileName}
					description={`Загружено строк: ${data.snapshot.rowCount}`}
					icon={<MapIcon />}
				/>
				<SummaryCard
					title="Уровни"
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
						<CardTitle className="text-sm font-medium text-muted-foreground">
							Средний прогресс
						</CardTitle>
						<CardDescription className="text-3xl font-semibold text-foreground">
							{data.snapshot.averageProgress}%
						</CardDescription>
					</CardHeader>
					<CardContent className="pt-0">
						<Progress value={data.snapshot.averageProgress} />
					</CardContent>
				</Card>
			</div>

			<div className="flex flex-col">
				<div
					ref={titleScrollRef}
					onScroll={() => syncScroll("title")}
					className="no-scrollbar overflow-x-auto overflow-y-hidden"
				>
					<div className="pl-4" style={{ minWidth: mapCanvasWidth }}>
						<MapTitle />
					</div>
				</div>

				<div
					className="sticky z-40 mt-5"
					style={{
						top: "var(--app-shell-header-height)",
					}}
				>
					<div
						ref={headerScrollRef}
						onScroll={() => syncScroll("header")}
						className="no-scrollbar overflow-x-auto overflow-y-hidden border-b-2 border-dashed border-zinc-400/90 bg-background/95 pb-3 pt-6 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.45)] backdrop-blur-sm dark:border-zinc-700 dark:bg-background/92"
					>
						<div className="pl-4" style={{ minWidth: mapCanvasWidth }}>
							<div
								className="grid items-center"
								style={{
									gridTemplateColumns: boardColumns,
								}}
							>
								<LeftZoneHeader />
								<div />
								<PathHeader side="dirty" />
								<div className="pb-1 text-center text-base font-semibold text-zinc-900 dark:text-zinc-100">
									Отметка
								</div>
								<PathHeader side="clean" />
								<div />
								<RightZoneHeader />
							</div>
						</div>
					</div>
				</div>

				<div
					ref={bodyScrollRef}
					onScroll={() => syncScroll("body")}
					className="w-full overflow-x-auto overflow-y-visible"
				>
					<div className="pl-4" style={{ minWidth: mapCanvasWidth }}>
						<div className="relative overflow-hidden">
							<BoardPathLayer bands={levelBands} />
							<div className="relative z-10">
								{levelBands.map((band, index) => (
									<LevelBandView
										key={`${band.level}:${band.levelOrder}`}
										band={band}
										bandIndex={index}
										canEditProgress={canEditProgress}
										canManageManualRooms={canManageManualRooms}
										isLast={index === levelBands.length - 1}
									/>
								))}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
