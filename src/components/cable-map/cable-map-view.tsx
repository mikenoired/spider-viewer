"use client";

import { Link } from "@tanstack/react-router";
import { FileUpIcon, Layers2Icon, MapIcon, PercentIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { canUploadSnapshot } from "@/lib/auth/shared";
import type {
	DashboardData,
	GraphBucketView,
	GraphGroupView,
} from "@/lib/cable-map/shared";
import { graphSideLabels, graphSubzoneLabels } from "@/lib/cable-map/shared";
import { cn } from "@/lib/utils";
import { GroupProgressSheet } from "./group-progress-sheet";

const shaftPalette = {
	0: {
		line: "#111827",
		fill: "#6b7280",
	},
	1: {
		line: "#0f84db",
		fill: "#1ea7fd",
	},
	2: {
		line: "#4b9a11",
		fill: "#71c71a",
	},
	3: {
		line: "#ea580c",
		fill: "#ff7a00",
	},
	4: {
		line: "#991b1b",
		fill: "#b1003c",
	},
} as const satisfies Record<
	GraphBucketView["shaft"],
	{
		line: string;
		fill: string;
	}
>;

const boardColumns = "46px 252px 52px 320px 112px 320px 52px 252px 46px";
const pdfRowHeight = 140;
const levelValuePattern = /^-?\d+(?:,\d+)?$/;
const zonePriority: Record<string, number> = {
	ГЗ: 0,
	ЧЗ: 1,
	ГО: 2,
	МЗ: 3,
	РДЭС: 4,
};

type GraphSide = GraphGroupView["graphSide"];
type LevelBandRow = {
	dirtyGroup: GraphGroupView | null;
	cleanGroup: GraphGroupView | null;
	globalRowIndex: number;
};
type LevelBand = {
	level: string;
	levelOrder: number;
	rows: LevelBandRow[];
	rowCount: number;
};

export function CableMapView({
	data,
	canEdit,
	role,
}: {
	data: DashboardData;
	canEdit: boolean;
	role: "user" | "admin" | "super-admin";
}) {
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
	return (
		<div className="flex flex-1 flex-col gap-4">
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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

			<Card className="overflow-hidden">
				<CardHeader className="pb-3">
					<CardTitle>Интерактивная карта демонтажа</CardTitle>
					<CardDescription>
						Вид карты приближен к PDF. Основной жёлтый блок помещения
						интерактивен и открывает таблицу прогресса.
					</CardDescription>
				</CardHeader>
				<CardContent className="pt-0">
					<ScrollArea className="w-full">
						<div className="min-w-[1540px] rounded-[28px] border border-zinc-300/80 bg-[#fcfcfa] px-6 py-6 shadow-sm dark:border-zinc-800 dark:bg-[#101318]">
							<MapTitle />

							<div className="mt-5 border-y-2 border-dashed border-zinc-400/90 py-3 dark:border-zinc-700">
								<div
									className="grid items-end gap-x-3"
									style={{
										gridTemplateColumns: boardColumns,
									}}
								>
									<div />
									<LeftZoneHeader />
									<div />
									<PathHeader side="dirty" />
									<div className="pb-1 text-center text-base font-semibold text-zinc-900 dark:text-zinc-100">
										Отметка
									</div>
									<PathHeader side="clean" />
									<div />
									<RightZoneHeader />
									<div />
								</div>
							</div>

							<div className="overflow-hidden rounded-[24px]">
								{levelBands.map((band, index) => (
									<LevelBandView
										key={`${band.level}:${band.levelOrder}`}
										band={band}
										bandIndex={index}
										nextBand={levelBands[index + 1] ?? null}
										canEdit={canEdit}
										isLast={index === levelBands.length - 1}
									/>
								))}
							</div>
						</div>
					</ScrollArea>
				</CardContent>
			</Card>
		</div>
	);
}

function buildLevelBands(levels: DashboardData["levels"]): LevelBand[] {
	let globalRowIndex = 0;

	return levels
		.filter((level) => levelValuePattern.test(level.level))
		.map((level) => {
			const dirtyGroups = sortGroupsForPdf(level.dirtyGroups);
			const cleanGroups = sortGroupsForPdf(level.cleanGroups);
			const rowCount = Math.max(dirtyGroups.length, cleanGroups.length, 1);
			const rows = Array.from({ length: rowCount }, (_, rowIndex) => ({
				dirtyGroup: dirtyGroups[rowIndex] ?? null,
				cleanGroup: cleanGroups[rowIndex] ?? null,
				globalRowIndex: globalRowIndex + rowIndex,
			}));

			globalRowIndex += rowCount;

			return {
				level: level.level,
				levelOrder: level.levelOrder,
				rows,
				rowCount,
			} satisfies LevelBand;
		});
}

function sortGroupsForPdf(groups: GraphGroupView[]) {
	return [...groups].sort((left, right) => {
		const leftPriority = zonePriority[left.sourceZone] ?? 99;
		const rightPriority = zonePriority[right.sourceZone] ?? 99;

		if (leftPriority !== rightPriority) {
			return leftPriority - rightPriority;
		}

		if (left.graphSubzone !== right.graphSubzone) {
			if (left.graphSubzone === "dirty") {
				return -1;
			}

			if (right.graphSubzone === "dirty") {
				return 1;
			}
		}

		return left.sourceZone.localeCompare(right.sourceZone, "ru", {
			numeric: true,
			sensitivity: "base",
		});
	});
}

function getBucketThreadCount(
	group: GraphGroupView,
	shaft: GraphBucketView["shaft"],
) {
	return (
		group.buckets.find((bucket) => bucket.shaft === shaft)?.threadCount ?? 0
	);
}

function MapTitle() {
	return (
		<div className="space-y-1 text-center">
			<div className="text-[30px] font-semibold leading-tight tracking-[-0.03em] text-zinc-950 dark:text-zinc-50">
				Демонтаж кабеля САЭ в части 1 канала СБ и НЭ энергоблока № 1
			</div>
			<div className="grid grid-cols-[1fr_auto_1fr] items-end gap-6 text-balance">
				<div className="text-[18px] font-semibold leading-tight text-zinc-900 dark:text-zinc-100">
					{graphSideLabels.dirty}
				</div>
				<div className="w-24" />
				<div className="text-[18px] font-semibold leading-tight text-zinc-900 dark:text-zinc-100">
					{graphSideLabels.clean}
				</div>
			</div>
		</div>
	);
}

function LeftZoneHeader() {
	return (
		<div className="grid h-11 grid-cols-[98px_minmax(0,1fr)] items-end gap-3 pb-1 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-700 dark:text-zinc-300">
			<div>{graphSubzoneLabels.dirty}</div>
			<div>{graphSubzoneLabels.clean}</div>
		</div>
	);
}

function RightZoneHeader() {
	return (
		<div className="flex h-11 items-end justify-center pb-1 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-700 dark:text-zinc-300">
			{graphSubzoneLabels.clean}
		</div>
	);
}

function PathHeader({ side }: { side: GraphSide }) {
	const shaftX = getShaftX(side);
	const guideOpacity = side === "dirty" ? 0.28 : 0.24;

	return (
		<svg
			viewBox="0 0 320 44"
			className="h-11 w-full text-zinc-700 dark:text-zinc-300"
			role="presentation"
		>
			{side === "dirty" ? (
				<line
					x1={132}
					y1={0}
					x2={132}
					y2={44}
					stroke="currentColor"
					strokeWidth="3"
				/>
			) : null}

			{([1, 2, 3, 4] as const).map((shaft) => (
				<g key={shaft}>
					<line
						x1={shaftX[shaft]}
						y1={0}
						x2={shaftX[shaft]}
						y2={44}
						stroke="currentColor"
						strokeWidth="1"
						strokeDasharray="4 5"
						opacity={guideOpacity}
					/>
					<text
						x={shaftX[shaft]}
						y={16}
						fontSize="11"
						fontWeight="700"
						fill="currentColor"
						textAnchor="middle"
					>
						КШ
					</text>
					<text
						x={shaftX[shaft]}
						y={31}
						fontSize="12"
						fontWeight="700"
						fill="currentColor"
						textAnchor="middle"
					>
						№ {shaft}
					</text>
				</g>
			))}
		</svg>
	);
}

function LevelBandView({
	band,
	bandIndex,
	nextBand,
	canEdit,
	isLast,
}: {
	band: LevelBand;
	bandIndex: number;
	nextBand: LevelBand | null;
	canEdit: boolean;
	isLast: boolean;
}) {
	const isPairStart = bandIndex % 2 === 0;
	const currentBandHeight = band.rowCount * pdfRowHeight;
	const nextBandHeight = nextBand ? nextBand.rowCount * pdfRowHeight : 0;
	const pairHeight = currentBandHeight + nextBandHeight;
	const dirtyScheduleSource =
		findBandGroupForSchedule(band, "dirty") ??
		(nextBand ? findBandGroupForSchedule(nextBand, "dirty") : null);
	const cleanScheduleSource =
		findBandGroupForSchedule(band, "clean") ??
		(nextBand ? findBandGroupForSchedule(nextBand, "clean") : null);

	return (
		<div
			className={cn(
				"relative grid border-t-2 border-dashed border-zinc-400/90 dark:border-zinc-700",
				isLast && "border-b-2",
			)}
			style={
				{
					gridTemplateColumns: boardColumns,
					gridTemplateRows: `repeat(${band.rowCount}, ${pdfRowHeight}px)`,
				} satisfies CSSProperties
			}
		>
			<div
				className="relative flex items-center justify-center border-x-2 border-dashed border-zinc-400/90 px-2 text-center dark:border-zinc-700"
				style={
					{
						gridColumn: "5",
						gridRow: `1 / span ${band.rowCount}`,
					} satisfies CSSProperties
				}
			>
				<div className="text-3xl font-semibold leading-none tracking-[-0.03em] text-zinc-900 dark:text-zinc-100">
					{band.level}
				</div>
			</div>

			<div
				className="pointer-events-none z-0"
				style={
					{
						gridColumn: "4",
						gridRow: `1 / span ${band.rowCount}`,
					} satisfies CSSProperties
				}
			>
				<PathBackdrop side="dirty" band={band} height={currentBandHeight} />
			</div>

			<div
				className="pointer-events-none z-0"
				style={
					{
						gridColumn: "6",
						gridRow: `1 / span ${band.rowCount}`,
					} satisfies CSSProperties
				}
			>
				<PathBackdrop side="clean" band={band} height={currentBandHeight} />
			</div>

			{isPairStart ? (
				<>
					<div
						className="relative z-10"
						style={
							{
								gridColumn: "1",
								gridRow: `1 / span ${band.rowCount}`,
							} satisfies CSSProperties
						}
					>
						<SchedulePill
							group={dirtyScheduleSource}
							side="dirty"
							height={pairHeight}
						/>
					</div>

					<div
						className="relative z-10"
						style={
							{
								gridColumn: "9",
								gridRow: `1 / span ${band.rowCount}`,
							} satisfies CSSProperties
						}
					>
						<SchedulePill
							group={cleanScheduleSource}
							side="clean"
							height={pairHeight}
						/>
					</div>
				</>
			) : null}

			{band.rows.map((row, rowIndex) => {
				const gridRow = String(rowIndex + 1);

				return (
					<LevelBandRowView
						key={`${band.level}:${row.globalRowIndex}`}
						row={row}
						gridRow={gridRow}
						canEdit={canEdit}
					/>
				);
			})}
		</div>
	);
}

function LevelBandRowView({
	row,
	gridRow,
	canEdit,
}: {
	row: LevelBandRow;
	gridRow: string;
	canEdit: boolean;
}) {
	return (
		<>
			<div style={{ gridColumn: "2", gridRow }}>
				<LeftRoomArea group={row.dirtyGroup} canEdit={canEdit} />
			</div>

			<div style={{ gridColumn: "3", gridRow }}>
				<TotalThreadsBadge group={row.dirtyGroup} />
			</div>

			<div className="relative z-10" style={{ gridColumn: "4", gridRow }}>
				<PathArea side="dirty" group={row.dirtyGroup} />
			</div>

			<div className="relative z-10" style={{ gridColumn: "6", gridRow }}>
				<PathArea side="clean" group={row.cleanGroup} />
			</div>

			<div style={{ gridColumn: "7", gridRow }}>
				<TotalThreadsBadge group={row.cleanGroup} />
			</div>

			<div style={{ gridColumn: "8", gridRow }}>
				<RightRoomArea group={row.cleanGroup} canEdit={canEdit} />
			</div>
		</>
	);
}

function findBandGroupForSchedule(band: LevelBand, side: GraphSide) {
	for (const row of band.rows) {
		const group = side === "dirty" ? row.dirtyGroup : row.cleanGroup;

		if (group) {
			return group;
		}
	}

	return null;
}

function PathBackdrop({
	side,
	band,
	height,
}: {
	side: GraphSide;
	band: LevelBand;
	height: number;
}) {
	const shaftX = getShaftX(side);

	return (
		<svg
			viewBox={`0 0 320 ${height}`}
			className="h-full w-full text-zinc-700 dark:text-zinc-300"
			role="presentation"
		>
			{side === "dirty" ? (
				<line
					x1={132}
					y1={0}
					x2={132}
					y2={height}
					stroke="currentColor"
					strokeWidth="3"
				/>
			) : null}

			{([1, 2, 3, 4] as const).map((shaft) => (
				<g key={shaft}>
					<line
						x1={shaftX[shaft]}
						y1={0}
						x2={shaftX[shaft]}
						y2={height}
						stroke="currentColor"
						strokeWidth="1"
						strokeDasharray="4 5"
						opacity="0.18"
					/>
					{bandHasShaftThreads(band, side, shaft) ? (
						<rect
							x={shaftX[shaft] - 10}
							y={4}
							width={20}
							height={Math.max(height - 8, 0)}
							fill={shaftPalette[shaft].fill}
							stroke={shaftPalette[shaft].line}
							strokeWidth="1.5"
							opacity="0.96"
						/>
					) : null}
				</g>
			))}
		</svg>
	);
}

function bandHasShaftThreads(
	band: LevelBand,
	side: GraphSide,
	shaft: 1 | 2 | 3 | 4,
) {
	return band.rows.some((row) => {
		const group = side === "dirty" ? row.dirtyGroup : row.cleanGroup;
		return group ? getBucketThreadCount(group, shaft) > 0 : false;
	});
}

function SchedulePill({
	group,
	side,
	height,
}: {
	group: GraphGroupView | null;
	side: GraphSide;
	height: number;
}) {
	if (!group) {
		return <div className="h-full" />;
	}

	const label =
		side === "dirty" && group.graphSubzone === "dirty"
			? "6 ч. в день / 6 ч. в ночь"
			: side === "dirty"
				? "10 ч. в день / 10 ч. в ночь"
				: "10 ч. в день / 10 ч. в ночь";

	return (
		<div className="flex items-center justify-center py-3" style={{ height }}>
			<div
				className="flex h-full w-8 items-center justify-center rounded-[10px] border border-zinc-400/80 bg-gradient-to-b from-zinc-100 to-zinc-200 px-1 text-[11px] font-medium text-zinc-700 shadow-sm dark:border-zinc-700 dark:from-zinc-900 dark:to-zinc-800 dark:text-zinc-300"
				style={{
					writingMode: "vertical-rl",
					transform: side === "dirty" ? "rotate(180deg)" : undefined,
				}}
			>
				{label}
			</div>
		</div>
	);
}

function LeftRoomArea({
	group,
	canEdit,
}: {
	group: GraphGroupView | null;
	canEdit: boolean;
}) {
	if (!group) {
		return <EmptyRoomArea side="dirty" />;
	}

	return (
		<div className="grid h-full grid-cols-[98px_minmax(0,1fr)] gap-3 py-4">
			<GroupProgressSheet
				group={group}
				canEdit={canEdit}
				variant="pdf"
				className="h-full"
			/>
			<StaticRoomBlock group={group} />
		</div>
	);
}

function RightRoomArea({
	group,
	canEdit,
}: {
	group: GraphGroupView | null;
	canEdit: boolean;
}) {
	if (!group) {
		return <EmptyRoomArea side="clean" />;
	}

	return (
		<div className="grid h-full grid-cols-[minmax(0,1fr)_98px] gap-3 py-4">
			<StaticRoomBlock group={group} align="right" />
			<GroupProgressSheet
				group={group}
				canEdit={canEdit}
				variant="pdf"
				className="h-full"
			/>
		</div>
	);
}

function StaticRoomBlock({
	group,
	align = "left",
}: {
	group: GraphGroupView;
	align?: "left" | "right";
}) {
	return (
		<div className="flex h-full flex-col rounded-[8px] border border-zinc-400/80 bg-white/90 px-3 py-2 text-zinc-900 shadow-sm dark:border-zinc-700 dark:bg-zinc-950/80 dark:text-zinc-100">
			<div className="mb-1 flex items-center justify-between gap-2">
				<div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
					{group.sourceZone}
				</div>
				<div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
					{group.secondaryRooms.length}
				</div>
			</div>
			<RoomNameGrid
				names={group.secondaryRooms.map((room) => room.roomName)}
				align={align}
				muted
			/>
		</div>
	);
}

function EmptyRoomArea({ side }: { side: GraphSide }) {
	return (
		<div
			className={cn(
				"grid h-full gap-3 py-4",
				side === "dirty"
					? "grid-cols-[98px_minmax(0,1fr)]"
					: "grid-cols-[minmax(0,1fr)_98px]",
			)}
		>
			<div className="rounded-[8px] border border-dashed border-zinc-300/90 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-950/40" />
			<div className="rounded-[8px] border border-dashed border-zinc-300/90 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-950/40" />
		</div>
	);
}

function RoomNameGrid({
	names,
	align,
	muted = false,
}: {
	names: string[];
	align: "left" | "right";
	muted?: boolean;
}) {
	const visibleNames = names.slice(0, 10);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div
				className={cn(
					"grid grid-cols-2 gap-x-2 gap-y-1 overflow-hidden text-[11px] font-medium leading-4",
					align === "right" && "text-right",
					muted
						? "text-zinc-700 dark:text-zinc-200"
						: "text-zinc-900 dark:text-zinc-50",
				)}
			>
				{visibleNames.map((name) => (
					<div key={name} className="truncate">
						{name}
					</div>
				))}
			</div>
			{names.length > visibleNames.length ? (
				<div className="mt-auto pt-2 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
					+{names.length - visibleNames.length}
				</div>
			) : null}
		</div>
	);
}

function TotalThreadsBadge({ group }: { group: GraphGroupView | null }) {
	if (!group) {
		return <div className="h-full" />;
	}

	return (
		<div className="flex h-full items-center justify-center py-4">
			<div className="rounded-[6px] border border-zinc-400/80 bg-[#fffdf3] px-2 py-1 text-center text-[11px] font-semibold text-zinc-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
				{group.threadCount} н
			</div>
		</div>
	);
}

function PathArea({
	side,
	group,
}: {
	side: GraphSide;
	group: GraphGroupView | null;
}) {
	const visibleBuckets = group
		? group.buckets.filter((bucket) => bucket.threadCount > 0)
		: [];
	const bucketY = getBucketY(visibleBuckets.length);

	return (
		<div className="h-full py-3">
			<svg
				viewBox="0 0 320 140"
				className="h-full w-full text-zinc-700 dark:text-zinc-300"
				role="presentation"
			>
				{visibleBuckets.map((bucket, index) => (
					<PathBucketRow
						key={bucket.shaft}
						side={side}
						bucket={bucket}
						y={bucketY[index] ?? 70}
					/>
				))}
			</svg>
		</div>
	);
}

function PathBucketRow({
	side,
	bucket,
	y,
}: {
	side: GraphSide;
	bucket: GraphBucketView;
	y: number;
}) {
	const shaftX = getShaftX(side);
	const color = shaftPalette[bucket.shaft].line;
	const layout = getBucketLayout(side, bucket, shaftX);
	const countLabel = `${bucket.threadCount} н`;
	const countWidth = Math.max(34, countLabel.length * 7 + 12);

	return (
		<>
			<text
				x={layout.labelX}
				y={y + 4}
				fontSize="12"
				fontWeight="500"
				fill="currentColor"
				textAnchor={layout.labelAnchor}
				style={{
					paintOrder: "stroke",
					stroke: "rgba(252, 252, 250, 0.96)",
					strokeWidth: 5,
					strokeLinejoin: "round",
				}}
			>
				{bucket.label}
			</text>
			<line
				x1={layout.lineStart}
				y1={y}
				x2={layout.lineEnd}
				y2={y}
				stroke={color}
				strokeWidth="2.4"
				strokeLinecap="round"
			/>
			{layout.arrowHead === "left" || layout.arrowHead === "both" ? (
				<ArrowHead direction="left" x={layout.lineStart} y={y} color={color} />
			) : null}
			{layout.arrowHead === "right" || layout.arrowHead === "both" ? (
				<ArrowHead direction="right" x={layout.lineEnd} y={y} color={color} />
			) : null}
			<rect
				x={layout.countX - countWidth / 2}
				y={y - 19}
				width={countWidth}
				height={18}
				rx={5}
				fill="rgba(252, 252, 250, 0.92)"
				stroke="rgba(113, 113, 122, 0.35)"
			/>
			<text
				x={layout.countX}
				y={y - 6}
				fontSize="12"
				fontWeight="700"
				fill="currentColor"
				textAnchor="middle"
			>
				{countLabel}
			</text>
		</>
	);
}

function getBucketLayout(
	side: GraphSide,
	bucket: GraphBucketView,
	shaftX: ReturnType<typeof getShaftX>,
) {
	if (side === "dirty") {
		if (bucket.shaft === 0) {
			return {
				labelX: 10,
				labelAnchor: "start" as const,
				lineStart: 110,
				lineEnd: 126,
				countX: 118,
				arrowHead: "both" as const,
			};
		}

		return {
			labelX: 10,
			labelAnchor: "start" as const,
			lineStart: 84,
			lineEnd: shaftX[bucket.shaft] - 14,
			countX: (84 + shaftX[bucket.shaft] - 14) / 2,
			arrowHead: "right" as const,
		};
	}

	if (bucket.shaft === 0) {
		return {
			labelX: 310,
			labelAnchor: "end" as const,
			lineStart: 188,
			lineEnd: 206,
			countX: 197,
			arrowHead: "both" as const,
		};
	}

	return {
		labelX: 310,
		labelAnchor: "end" as const,
		lineStart: shaftX[bucket.shaft] + 14,
		lineEnd: 236,
		countX: (shaftX[bucket.shaft] + 14 + 236) / 2,
		arrowHead: "left" as const,
	};
}

function ArrowHead({
	direction,
	x,
	y,
	color,
}: {
	direction: "left" | "right";
	x: number;
	y: number;
	color: string;
}) {
	const size = 6;
	const points =
		direction === "right"
			? `${x - size},${y - size / 1.3} ${x},${y} ${x - size},${y + size / 1.3}`
			: `${x + size},${y - size / 1.3} ${x},${y} ${x + size},${y + size / 1.3}`;

	return <polygon points={points} fill={color} />;
}

function getShaftX(side: GraphSide) {
	return side === "dirty"
		? {
				1: 168,
				2: 202,
				3: 236,
				4: 270,
			}
		: {
				1: 50,
				2: 84,
				3: 118,
				4: 152,
			};
}

function getBucketY(count: number) {
	if (count <= 1) {
		return [70];
	}

	if (count === 2) {
		return [54, 86];
	}

	if (count === 3) {
		return [42, 70, 98];
	}

	if (count === 4) {
		return [32, 56, 80, 104];
	}

	return [24, 46, 68, 90, 112];
}

function SummaryCard({
	title,
	value,
	description,
	icon,
}: {
	title: string;
	value: string;
	description: string;
	icon: ReactNode;
}) {
	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
				<div className="flex flex-col gap-1">
					<CardTitle className="text-sm font-medium text-muted-foreground">
						{title}
					</CardTitle>
					<CardDescription className="text-2xl font-semibold text-foreground">
						{value}
					</CardDescription>
				</div>
				<div className="rounded-xl border bg-muted/30 p-2 text-muted-foreground">
					{icon}
				</div>
			</CardHeader>
			<CardContent className="pt-0 text-sm text-muted-foreground">
				{description}
			</CardContent>
		</Card>
	);
}
