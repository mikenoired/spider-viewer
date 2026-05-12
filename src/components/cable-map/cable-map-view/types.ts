import type { GraphGroupView } from "@/lib/cable-map/shared";

export type GraphSide = GraphGroupView["graphSide"];

export type LevelBandRow = {
	dirtyGroup: GraphGroupView | null;
	cleanGroup: GraphGroupView | null;
	globalRowIndex: number;
	height: number;
	startY: number;
};

export type LevelBand = {
	level: string;
	levelOrder: number;
	rows: LevelBandRow[];
	rowCount: number;
	startY: number;
};

export type ShaftExtent = {
	top: number;
	bottom: number;
};

export type BoardMetrics = {
	height: number;
	shaftExtents: Record<GraphSide, Partial<Record<1 | 2 | 3 | 4, ShaftExtent>>>;
};
