import {
	AlignmentType,
	Document,
	ImageRun,
	Packer,
	Paragraph,
	Table,
	TableCell,
	TableLayoutType,
	TableRow,
	TextRun,
	WidthType,
} from "docx";

import type { RenderedMarker } from "../contracts.js";

function makeCell(
	text: string,
	widthTwip: number,
	options: {
		alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
		bold?: boolean;
		color?: string;
	} = {}
): TableCell {
	return new TableCell({
		width: {
			size: widthTwip,
			type: WidthType.DXA,
		},
		children: [
			new Paragraph({
				alignment: options.alignment,
				children: [
					new TextRun({
						text,
						bold: options.bold,
						color: options.color,
					}),
				],
			}),
		],
	});
}

function buildLegendTable(markers: RenderedMarker[]): Table {
	const columnWidths = [700, 2500, 4200, 1600] as const;

	const rows = [
		new TableRow({
			children: [
				makeCell("№", columnWidths[0], { alignment: AlignmentType.CENTER, bold: true }),
				makeCell("KKS", columnWidths[1], { bold: true }),
				makeCell("Текстовое описание", columnWidths[2], { bold: true }),
				makeCell("Подмодель", columnWidths[3], { bold: true }),
			],
		}),
		...markers.map(
			(marker) =>
				new TableRow({
					children: [
						makeCell(String(marker.index), columnWidths[0], {
							alignment: AlignmentType.CENTER,
							color: marker.isMismatch ? "CC0000" : undefined,
						}),
						makeCell(marker.kks ?? marker.title, columnWidths[1]),
						makeCell(marker.description ?? "", columnWidths[2]),
						makeCell(marker.submodel ?? "", columnWidths[3]),
					],
				})
		),
	];

	return new Table({
		width: {
			size: 100,
			type: WidthType.PERCENTAGE,
		},
		columnWidths: [...columnWidths],
		layout: TableLayoutType.FIXED,
		rows,
	});
}

export async function buildDocx(
	imagePng: Buffer,
	width: number,
	height: number,
	markers: RenderedMarker[]
): Promise<Buffer> {
	const maxWidth = 900;
	const imageWidth = width > maxWidth ? maxWidth : width;
	const imageHeight = Math.max(1, Math.round((height / width) * imageWidth));

	const children: Array<Paragraph | Table> = [
		new Paragraph({
			alignment: AlignmentType.CENTER,
			children: [
				new ImageRun({
					data: imagePng,
					type: "png",
					transformation: {
						width: imageWidth,
						height: imageHeight,
					},
				}),
			],
		}),
		new Paragraph({ text: "" }),
	];

	if (markers.length === 0) {
		children.push(new Paragraph({ children: [new TextRun("Элементов с title не найдено")] }));
	} else {
		children.push(buildLegendTable(markers));

		const mismatches = markers.filter((marker) => marker.isMismatch);
		if (mismatches.length > 0) {
			children.push(new Paragraph({ text: "" }));
			children.push(
				new Paragraph({
					children: [
						new TextRun({
							text: "Несовпадения title/KKS:",
							bold: true,
						}),
					],
				})
			);

			for (const marker of mismatches) {
				children.push(
					new Paragraph({
						children: [new TextRun(`№ ${marker.index}: title="${marker.title}", KKS="${marker.kks ?? ""}"`)],
					})
				);
			}
		}
	}

	const doc = new Document({
		sections: [
			{
				children,
			},
		],
	});

	return Packer.toBuffer(doc);
}
