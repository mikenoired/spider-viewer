import type { ReactNode } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { graphSideLabels, graphSubzoneLabels } from "@/lib/cable-map/shared";
import type { GraphSide } from "./types";
import { getShaftX } from "./utils";

export function MapTitle() {
	return (
		<div className="space-y-1 text-center">
			<div className="text-[30px] font-semibold leading-tight text-zinc-950 dark:text-zinc-50">
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

export function LeftZoneHeader() {
	return (
		<div className="grid h-11 grid-cols-[98px_minmax(0,1fr)] items-center gap-3 pb-1 text-center text-base font-semibold text-zinc-700 dark:text-zinc-300">
			<div>{graphSubzoneLabels.dirty}</div>
			<div>{graphSubzoneLabels.clean}</div>
		</div>
	);
}

export function RightZoneHeader() {
	return (
		<div className="grid h-11 grid-cols-[minmax(0,1fr)_98px] items-center gap-3 pb-1 text-center text-base font-semibold text-zinc-700 dark:text-zinc-300">
			<div />
			<div>{graphSubzoneLabels.clean}</div>
		</div>
	);
}

export function PathHeader({ side }: { side: GraphSide }) {
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

export function SummaryCard({
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
