import type { RecognizedTextLine } from "@/lib/installation-photo/recognition";

import type { DocumentCableRow } from "./task-documents";

type Mark = { center: number; height: number };

// The supplied assignments place handwritten pluses outside the table, at both margins.
// Keep this conservative: interior ink, dates and ambiguous row alignment need manual review.
export function findMarginPluses(pixels: Pick<ImageData, "width" | "height" | "data">): Mark[] {
	const { width, height, data } = pixels;
	const band = Math.ceil(width * 0.06);
	const marks: Mark[] = [];
	for (const offset of [0, width - band]) {
		const ink = new Uint8Array(band * height);
		for (let y = 0; y < height; y++)
			for (let x = 0; x < band; x++) {
				const i = (y * width + offset + x) * 4;
				ink[y * band + x] = (data[i]! + data[i + 1]! + data[i + 2]!) / 3 < 115 ? 1 : 0;
			}
		for (let index = 0; index < ink.length; index++) {
			if (!ink[index]) continue;
			const queue = [index];
			ink[index] = 0;
			let left = band,
				right = 0,
				top = height,
				bottom = 0;
			for (let cursor = 0; cursor < queue.length; cursor++) {
				const point = queue[cursor]!;
				const x = point % band,
					y = Math.floor(point / band);
				left = Math.min(left, x);
				right = Math.max(right, x);
				top = Math.min(top, y);
				bottom = Math.max(bottom, y);
				for (let dy = -1; dy <= 1; dy++)
					for (let dx = -1; dx <= 1; dx++) {
						const nx = x + dx,
							ny = y + dy,
							next = ny * band + nx;
						if (nx >= 0 && nx < band && ny >= 0 && ny < height && ink[next]) {
							ink[next] = 0;
							queue.push(next);
						}
					}
			}
			const w = right - left + 1,
				h = bottom - top + 1;
			if (
				w < 8 ||
				h < 8 ||
				w > width * 0.035 ||
				h > height * 0.055 ||
				w / h < 0.35 ||
				w / h > 2.8 ||
				queue.length / (w * h) > 0.65
			)
				continue;
			const xs = new Uint32Array(w),
				ys = new Uint32Array(h);
			for (const point of queue) {
				xs[(point % band) - left]!++;
				ys[Math.floor(point / band) - top]!++;
			}
			const cx = xs.indexOf(Math.max(...xs)),
				cy = ys.indexOf(Math.max(...ys));
			if (
				xs[cx]! / h >= 0.55 &&
				ys[cy]! / w >= 0.55 &&
				cx / w > 0.18 &&
				cx / w < 0.82 &&
				cy / h > 0.18 &&
				cy / h < 0.82
			)
				marks.push({ center: (top + bottom) / 2, height: h });
		}
	}
	return marks;
}

const identity = (text: string) =>
	text.toUpperCase().replace(/[НХК]/g, (char) => ({ Н: "H", Х: "X", К: "K" })[char]!);
export function applyMarginPluses(rows: DocumentCableRow[], lines: RecognizedTextLine[], marks: Mark[]) {
	const anchors = rows
		.map((row) => {
			const line = lines.find(
				(line) => line.boundingBox && identity(line.text).includes(identity(row.cableLabel))
			);
			const box = line?.boundingBox;
			return box ? { row, center: box.top + box.height / 2, height: box.height } : null;
		})
		.filter((anchor) => anchor !== null);
	for (const mark of marks) {
		const candidates = anchors.filter(
			(anchor) => Math.abs(anchor.center - mark.center) <= Math.max(anchor.height * 0.8, mark.height * 0.65)
		);
		if (candidates.length === 1) candidates[0]!.row.completed = true;
	}
}
