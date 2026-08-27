import type { RawMarker, RenderedMarker } from "../contracts.js";

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function projectMarkers(
	rawMarkers: RawMarker[],
	renderedWidth: number,
	renderedHeight: number,
	viewWidth?: number,
	viewHeight?: number
): RenderedMarker[] {
	const scaleX = viewWidth && viewWidth > 0 ? renderedWidth / viewWidth : 1;
	const scaleY = viewHeight && viewHeight > 0 ? renderedHeight / viewHeight : 1;

	const radius = clamp(Math.round(renderedWidth / 160), 10, 18);
	const step = radius * 2 + 6;
	const cols = Math.max(1, Math.floor((renderedWidth - 20) / step));
	let fallbackIndex = 0;

	return rawMarkers.map((marker) => {
		let x: number;
		let y: number;

		if (marker.point) {
			x = marker.point.x * scaleX;
			y = marker.point.y * scaleY;
		} else {
			const col = fallbackIndex % cols;
			const row = Math.floor(fallbackIndex / cols);
			x = 10 + col * step;
			y = 10 + row * step;
			fallbackIndex += 1;
		}

		x = clamp(x, radius + 2, renderedWidth - radius - 2);
		y = clamp(y, radius + 2, renderedHeight - radius - 2);

		return {
			index: marker.index,
			title: marker.title,
			kks: marker.kks,
			submodel: marker.submodel,
			description: marker.description,
			isMismatch: marker.isMismatch,
			x,
			y,
		};
	});
}

export function buildOverlaySvg(markers: RenderedMarker[], width: number, height: number): string {
	const radius = clamp(Math.round(width / 160), 10, 18);
	const textSizeBase = clamp(Math.round(radius * 0.95), 10, 15);

	const nodes = markers
		.map((marker) => {
			const text = String(marker.index);
			const textSize = text.length >= 3 ? Math.max(9, textSizeBase - 3) : textSizeBase;
			return `<g>
  <circle cx="${marker.x.toFixed(2)}" cy="${marker.y.toFixed(2)}" r="${radius}" fill="#d62828" stroke="white" stroke-width="1.5" />
  <text x="${marker.x.toFixed(2)}" y="${(marker.y + textSize * 0.35).toFixed(2)}" font-family="Arial, sans-serif" font-size="${textSize}" font-weight="700" fill="#ffffff" text-anchor="middle">${text}</text>
</g>`;
		})
		.join("\n");

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${nodes}
</svg>`;
}
