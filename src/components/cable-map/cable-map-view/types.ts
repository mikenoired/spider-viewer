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
