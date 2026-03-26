import { describe, expect, it } from "vitest";

import type { GraphGroupView } from "@/lib/cable-map/shared";

import { buildLevelBands } from "./utils";

function createGroup(overrides: Partial<GraphGroupView> = {}): GraphGroupView {
	return {
		id: "group-1",
		groupKey: "dirty:dirty:ГЗ:Техэтаж",
		graphSide: "dirty",
		graphSubzone: "dirty",
		sourceZone: "ГЗ",
		level: "Техэтаж",
		levelOrder: 0,
		cableCount: 1,
		threadCount: 4,
		totalLength: 12,
		copperMassKg: 0,
		averageProgress: 0,
		primaryRooms: [],
		secondaryRooms: [],
		manualRooms: [],
		buckets: [
			{ shaft: 0, label: "Не заходит в КШ", threadCount: 4 },
			{ shaft: 1, label: "В КШ 1", threadCount: 0 },
			{ shaft: 2, label: "В КШ 2", threadCount: 0 },
			{ shaft: 3, label: "В КШ 3", threadCount: 0 },
			{ shaft: 4, label: "В КШ 4", threadCount: 0 },
		],
		...overrides,
	};
}

describe("buildLevelBands", () => {
	it("keeps non-numeric levels in the rendered board", () => {
		const bands = buildLevelBands([
			{
				level: "Техэтаж",
				levelOrder: 0,
				dirtyGroups: [createGroup()],
				cleanGroups: [],
			},
		]);

		expect(bands).toHaveLength(1);
		expect(bands[0]?.level).toBe("Техэтаж");
	});
});
