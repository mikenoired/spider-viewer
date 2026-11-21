export type PseFloor = { level: string; levelOrder: number };

export const pseUnknownFloor: PseFloor = {
	level: "Уровень не указан",
	levelOrder: Number.MIN_SAFE_INTEGER,
};

const reactorFloors = [45.6, 41.4, 36.6, 33.6, 28.8, 24.6, 24, 19.2, 16.6, 13.2, 6.6, 3.6, 0, -4.2];
const containmentFloors = [36.6, 33.6, 29.4, 25.7, 19.34, 13.2];
const containmentRoom = /^[ГG][АA]/i;

function getFloorMark(room: string, value: unknown) {
	const height = String(value ?? "")
		.trim()
		.replace(",", ".");
	if (typeof value !== "number" && !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(height)) return;
	const z = Number(height);
	const containment = containmentRoom.test(room);
	if (!Number.isFinite(z) || z >= (containment ? 45 : 50.4)) return;
	return (containment ? containmentFloors : reactorFloors).find((mark) => mark <= z);
}

export function buildPseRoomFloors(observations: Array<{ room: string; z: unknown }>) {
	const votesByRoom = new Map<string, Map<number, number>>();
	for (const { room, z } of observations) {
		const mark = getFloorMark(room, z);
		if (mark === undefined) continue;
		const votes = votesByRoom.get(room) ?? new Map<number, number>();
		votes.set(mark, (votes.get(mark) ?? 0) + 1);
		votesByRoom.set(room, votes);
	}

	const floors = new Map<string, PseFloor>();
	for (const [room, votes] of votesByRoom) {
		const ranked = [...votes].sort((left, right) => right[1] - left[1]);
		const [mark, count] = ranked[0]!;
		if (count === ranked[1]?.[1]) continue;
		const label = String(mark).replace(".", ",");
		floors.set(room, {
			level: containmentRoom.test(room) ? `Гермообъём · ${label}` : label,
			levelOrder: mark,
		});
	}
	return floors;
}
