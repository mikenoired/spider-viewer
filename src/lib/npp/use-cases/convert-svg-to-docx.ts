import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import type { SearchMarkerRecord } from "../search/index.js";
import { buildDocx } from "../services/docx-builder.js";
import { buildOverlaySvg, projectMarkers } from "../services/marker-rendering.js";
import { type DescriptionIndex, lookupDescription } from "../services/pls-db.js";
import { decodeSvgBuffer, parseMarkers, toUtf8Xml } from "../services/svg-parser.js";

export async function convertSvgToDocx(
	svgPath: string,
	outputPath: string,
	descriptions: DescriptionIndex
): Promise<{ markers: number; mismatches: number; encoding: string; searchRecords: SearchMarkerRecord[] }> {
	const rawBuffer = await readFile(svgPath);
	const { content: svgContent, encoding } = decodeSvgBuffer(rawBuffer);
	const svgForRender = toUtf8Xml(svgContent);

	const parsed = parseMarkers(svgContent);
	const enrichedMarkers = parsed.markers.map((marker) => ({
		...marker,
		description: lookupDescription(descriptions, marker.kks),
	}));

	const sourcePng = await sharp(Buffer.from(svgForRender, "utf8")).png().toBuffer();
	const metadata = await sharp(sourcePng).metadata();
	const width = metadata.width;
	const height = metadata.height;
	if (!width || !height) {
		throw new Error("Не удалось вычислить размер выходной картинки");
	}

	const renderedMarkers = projectMarkers(enrichedMarkers, width, height, parsed.viewWidth, parsed.viewHeight);
	const overlaySvg = buildOverlaySvg(renderedMarkers, width, height);
	const compositedPng = await sharp(sourcePng)
		.composite([{ input: Buffer.from(overlaySvg) }])
		.png()
		.toBuffer();

	const docxBuffer = await buildDocx(compositedPng, width, height, renderedMarkers);
	await writeFile(outputPath, docxBuffer);

	return {
		markers: renderedMarkers.length,
		mismatches: renderedMarkers.filter((marker) => marker.isMismatch).length,
		encoding,
		searchRecords: renderedMarkers
			.filter((marker) => typeof marker.submodel === "string" && marker.submodel.trim().length > 0)
			.map((marker) => ({
				frameName: path.basename(svgPath),
				markerIndex: marker.index,
				submodel: marker.submodel ?? "",
				kks: marker.kks,
				title: marker.title,
				description: marker.description,
			})),
	};
}
