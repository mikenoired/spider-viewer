import { memo } from "react"
import type { GraphBucketView, GraphGroupView } from "@/lib/cable-map/shared"
import { cn } from "@/lib/utils"
import { cleanPathColumnStart, dirtyPathColumnStart, pathColumnWidth, shaftPalette } from "./config"
import type { BoardMetrics, GraphSide } from "./types"
import { getBucketY, getShaftX } from "./utils"

export const BoardPathLayer = memo(function BoardPathLayer({ metrics }: { metrics: BoardMetrics }) {
	const { height } = metrics

	if (height <= 0) return

	return (
		<div className="pointer-events-none absolute inset-0 z-0">
			<div
				className="absolute inset-y-0"
				style={{ left: dirtyPathColumnStart, width: pathColumnWidth }}>
				<PathColumnBackdrop side="dirty" metrics={metrics} height={height} />
			</div>
			<div
				className="absolute inset-y-0"
				style={{ left: cleanPathColumnStart, width: pathColumnWidth }}>
				<PathColumnBackdrop side="clean" metrics={metrics} height={height} />
			</div>
		</div>
	)
})

function PathColumnBackdrop({
	side,
	metrics,
	height,
}: {
	side: GraphSide
	metrics: BoardMetrics
	height: number
}) {
	const shaftX = getShaftX(side)

	return (
		<svg
			viewBox={`0 0 320 ${height}`}
			className="h-full w-full text-zinc-700 dark:text-zinc-300"
			role="presentation"
			preserveAspectRatio="none">
			{side === "dirty" ? (
				<line x1={132} y1={0} x2={132} y2={height} stroke="currentColor" strokeWidth="3" />
			) : null}

			{([1, 2, 3, 4] as const).map(shaft => {
				const extent = metrics.shaftExtents[side][shaft]

				if (!extent) return null

				return (
					<rect
						key={`shaft-fill:${shaft}`}
						x={shaftX[shaft] - 10}
						y={extent.top}
						width={20}
						height={extent.bottom - extent.top}
						fill={shaftPalette[shaft].fill}
						stroke={shaftPalette[shaft].line}
						strokeWidth="1.5"
						opacity="0.96"
					/>
				)
			})}

			{([1, 2, 3, 4] as const).map(shaft => (
				<line
					key={`shaft-guide:${shaft}`}
					x1={shaftX[shaft]}
					y1={0}
					x2={shaftX[shaft]}
					y2={height}
					stroke="currentColor"
					strokeWidth="1"
					strokeDasharray="4 5"
					opacity="0.22"
				/>
			))}
		</svg>
	)
}

export const PathArea = memo(function PathArea({
	side,
	group,
	height,
}: {
	side: GraphSide
	group: GraphGroupView | null
	height: number
}) {
	const visibleBuckets = group ? group.buckets.filter(bucket => bucket.threadCount > 0) : []
	const bucketY = getBucketY(visibleBuckets.length, height)

	return (
		<svg
			viewBox={`0 0 320 ${height}`}
			className="h-full w-full text-zinc-700 dark:text-zinc-300"
			role="presentation">
			{visibleBuckets.map((bucket, index) => (
				<PathBucketRow key={bucket.shaft} side={side} bucket={bucket} y={bucketY[index] ?? 70} />
			))}
		</svg>
	)
})

function PathBucketRow({
	side,
	bucket,
	y,
}: {
	side: GraphSide
	bucket: GraphBucketView
	y: number
}) {
	const shaftX = getShaftX(side)
	const color = shaftPalette[bucket.shaft].line
	const layout = getBucketLayout(side, bucket, shaftX)
	const countLabel = `${bucket.threadCount} н`
	const countWidth = Math.max(34, countLabel.length * 7 + 12)

	return (
		<>
			<text
				x={layout.labelX}
				y={y + 4}
				fontSize="12"
				fontWeight="500"
				fill="currentColor"
				textAnchor={layout.labelAnchor}>
				{bucket.label}
			</text>
			<line
				x1={layout.lineStart}
				y1={y}
				x2={layout.lineEnd}
				y2={y}
				stroke={color}
				className={cn(bucket.shaft === 0 ? "dark:stroke-white" : "")}
				strokeWidth="2.4"
				strokeLinecap="round"
			/>
			{layout.arrowHead === "left" ? (
				<ArrowHead direction="left" x={layout.lineStart} y={y} color={color} shaft={bucket.shaft} />
			) : null}
			{layout.arrowHead === "right" ? (
				<ArrowHead direction="right" x={layout.lineEnd} y={y} color={color} shaft={bucket.shaft} />
			) : null}
			<rect
				x={layout.countX - countWidth / 2}
				y={y - 25}
				width={countWidth}
				height={18}
				rx={5}
				fill={color}
				className={cn(bucket.shaft === 0 ? "dark:fill-white" : "")}
			/>
			<text
				x={layout.countX}
				y={y - 12}
				fontSize="12"
				fontWeight="700"
				fill="white"
				className={cn(bucket.shaft === 0 ? "dark:fill-black" : "")}
				textAnchor="middle">
				{countLabel}
			</text>
		</>
	)
}

function getBucketLayout(
	side: GraphSide,
	bucket: GraphBucketView,
	shaftX: ReturnType<typeof getShaftX>
) {
	if (side === "dirty") {
		if (bucket.shaft === 0) {
			return {
				labelX: 10,
				labelAnchor: "start" as const,
				lineStart: 110,
				lineEnd: 126,
				countX: 118,
				arrowHead: "right" as const,
			}
		}

		return {
			labelX: 10,
			labelAnchor: "start" as const,
			lineStart: 64,
			lineEnd: shaftX[bucket.shaft] - 14,
			countX: (84 + shaftX[bucket.shaft] - 14) / 2,
			arrowHead: "right" as const,
		}
	}

	if (bucket.shaft === 0) {
		return {
			labelX: 310,
			labelAnchor: "end" as const,
			lineStart: 188,
			lineEnd: 206,
			countX: 197,
			arrowHead: "left" as const,
		}
	}

	return {
		labelX: 310,
		labelAnchor: "end" as const,
		lineStart: shaftX[bucket.shaft] + 14,
		lineEnd: 256,
		countX: (shaftX[bucket.shaft] + 14 + 236) / 2,
		arrowHead: "left" as const,
	}
}

function ArrowHead({
	direction,
	x,
	y,
	color,
	shaft,
}: {
	direction: "left" | "right"
	x: number
	y: number
	color: string
	shaft: 0 | 1 | 2 | 3 | 4
}) {
	const size = 6
	const points =
		direction === "right"
			? `${x - size},${y - size / 1.3} ${x},${y} ${x - size},${y + size / 1.3}`
			: `${x + size},${y - size / 1.3} ${x},${y} ${x + size},${y + size / 1.3}`

	return (
		<polygon points={points} fill={color} className={cn(shaft === 0 ? "dark:fill-white" : "")} />
	)
}

BoardPathLayer.displayName = "BoardPathLayer"
PathArea.displayName = "PathArea"
