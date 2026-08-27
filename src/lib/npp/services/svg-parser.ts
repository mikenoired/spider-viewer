import iconv from "iconv-lite";
import sax from "sax";

import type { ParsedSvg, Point, RawMarker } from "../contracts.js";

type ElementCtx = {
	name: string;
	attrs: Record<string, string>;
	dynValues: Record<string, string>;
	titleText?: string;
	textContent?: string;
	firstChildPoint?: Point;
};

function normalizeEncoding(label: string): string {
	const lowered = label.trim().toLowerCase();
	if (lowered === "utf8") {
		return "utf-8";
	}
	if (lowered === "windows1251" || lowered === "cp1251") {
		return "windows-1251";
	}
	return lowered;
}

export function decodeSvgBuffer(buffer: Buffer): { content: string; encoding: string } {
	const prolog = buffer.subarray(0, 512).toString("latin1");
	const encodingMatch = prolog.match(/encoding\s*=\s*["']([^"']+)["']/i);
	const requested = normalizeEncoding(encodingMatch?.[1] ?? "utf-8");
	const encoding = iconv.encodingExists(requested) ? requested : "utf-8";
	const content = iconv.decode(buffer, encoding);
	return { content, encoding };
}

export function toUtf8Xml(svgContent: string): string {
	if (/^<\?xml/i.test(svgContent)) {
		return svgContent.replace(/(<\?xml[^>]*encoding\s*=\s*["'])[^"']+(["'][^>]*\?>)/i, "$1UTF-8$2");
	}
	return svgContent;
}

function parseNumeric(value: string | undefined): number | undefined {
	if (!value) {
		return undefined;
	}
	const match = value.match(/-?\d+(\.\d+)?/);
	if (!match) {
		return undefined;
	}
	const parsed = Number.parseFloat(match[0]);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function parsePoints(points: string | undefined): Point | undefined {
	if (!points) {
		return undefined;
	}
	const pairs = points.trim().split(/\s+/);
	for (const pair of pairs) {
		const [xRaw, yRaw] = pair.split(",");
		const x = parseNumeric(xRaw);
		const y = parseNumeric(yRaw);
		if (x !== undefined && y !== undefined) {
			return { x, y };
		}
	}
	return undefined;
}

function decodeXmlEntities(input: string): string {
	return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, entity: string) => {
		const lowered = entity.toLowerCase();
		if (lowered === "amp") return "&";
		if (lowered === "lt") return "<";
		if (lowered === "gt") return ">";
		if (lowered === "quot") return '"';
		if (lowered === "apos") return "'";

		if (lowered.startsWith("#x")) {
			const code = Number.parseInt(lowered.slice(2), 16);
			return Number.isFinite(code) ? String.fromCodePoint(code) : `&${entity};`;
		}
		if (lowered.startsWith("#")) {
			const code = Number.parseInt(lowered.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : `&${entity};`;
		}
		return `&${entity};`;
	});
}

function cleanTitle(raw: string): string {
	const value = decodeXmlEntities(raw)
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^["']+|["']+$/g, "")
		.trim();
	return value.length > 0 ? value : "(empty title)";
}

function normalizeIdentity(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	const normalized = cleanTitle(value);
	return normalized === "(empty title)" ? undefined : normalized;
}

function normalizeDynType(value: string | undefined): string | undefined {
	const normalized = normalizeIdentity(value);
	if (!normalized) {
		return undefined;
	}
	return normalized
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toUpperCase();
}

function pickMarkerKks(dynValues: Record<string, string>, title: string): string | undefined {
	const priorities = ["FKKS", "KKS", "POINTID_STATUS", "POINTID"];
	for (const priority of priorities) {
		const found = normalizeIdentity(dynValues[priority]);
		if (found) {
			return found;
		}
	}
	return normalizeIdentity(title);
}

function isTitleMismatch(title: string, kks: string | undefined): boolean {
	const normalizedTitle = normalizeIdentity(title);
	const normalizedKks = normalizeIdentity(kks);
	return normalizedTitle !== undefined && normalizedKks !== undefined && normalizedTitle !== normalizedKks;
}

function getAttr(attrs: Record<string, string>, ...names: string[]): string | undefined {
	const lookup = new Set(names.map((name) => name.toLowerCase()));
	for (const [key, value] of Object.entries(attrs)) {
		if (lookup.has(key.toLowerCase())) {
			return value;
		}
	}
	return undefined;
}

function resolveElementPoint(node: ElementCtx): Point | undefined {
	const tag = node.name.toLowerCase();
	const x = parseNumeric(getAttr(node.attrs, "x", "cx", "x1"));
	const y = parseNumeric(getAttr(node.attrs, "y", "cy", "y1"));
	const width = parseNumeric(getAttr(node.attrs, "width"));
	const height = parseNumeric(getAttr(node.attrs, "height"));

	if ((tag === "image" || tag === "rect") && x !== undefined && y !== undefined) {
		if (width !== undefined && height !== undefined) {
			return { x: x + width, y };
		}
		return { x, y };
	}

	if ((tag === "text" || tag === "circle" || tag === "ellipse") && x !== undefined && y !== undefined) {
		return { x, y };
	}

	if (x !== undefined && y !== undefined) {
		return { x, y };
	}

	return parsePoints(getAttr(node.attrs, "points"));
}

function parseViewBox(value: string | undefined): { width?: number; height?: number } {
	if (!value) {
		return {};
	}
	const numbers = value
		.split(/[\s,]+/)
		.map((chunk) => Number.parseFloat(chunk))
		.filter((n) => Number.isFinite(n));
	if (numbers.length >= 4) {
		return { width: numbers[2], height: numbers[3] };
	}
	return {};
}

function parseMarkersWithSax(svgContent: string): ParsedSvg {
	const parser = sax.parser(false, {
		lowercase: true,
		trim: false,
		normalize: false,
		xmlns: false,
	});

	const stack: ElementCtx[] = [];
	const markers: RawMarker[] = [];
	let viewWidth: number | undefined;
	let viewHeight: number | undefined;

	parser.onopentag = (tag) => {
		const attrs: Record<string, string> = {};
		for (const [key, rawValue] of Object.entries(tag.attributes ?? {})) {
			attrs[key] =
				typeof rawValue === "string" ? rawValue : String((rawValue as { value?: unknown }).value ?? "");
		}

		const parent = stack[stack.length - 1];
		if (parent && tag.name === "rt:dyn") {
			const dynType = normalizeDynType(getAttr(attrs, "type"));
			const dynValue = normalizeIdentity(getAttr(attrs, "value"));
			if (dynType && dynValue) {
				parent.dynValues[dynType] = dynValue;
			}
		}

		const node: ElementCtx = {
			name: tag.name,
			attrs,
			dynValues: {},
		};
		stack.push(node);

		if (node.name === "svg" && (viewWidth === undefined || viewHeight === undefined)) {
			const parsedViewBox = parseViewBox(getAttr(attrs, "viewbox"));
			viewWidth = parsedViewBox.width ?? parseNumeric(getAttr(attrs, "width"));
			viewHeight = parsedViewBox.height ?? parseNumeric(getAttr(attrs, "height"));
		}
	};

	parser.ontext = (text) => {
		const current = stack[stack.length - 1];
		if (current?.name === "title") {
			current.textContent = (current.textContent ?? "") + text;
		}
	};

	parser.oncdata = (text) => {
		const current = stack[stack.length - 1];
		if (current?.name === "title") {
			current.textContent = (current.textContent ?? "") + text;
		}
	};

	parser.onclosetag = () => {
		const node = stack.pop();
		if (!node) {
			return;
		}

		if (node.name === "title") {
			const parent = stack[stack.length - 1];
			if (parent && parent.titleText === undefined) {
				parent.titleText = node.textContent ?? "";
			}
			return;
		}

		const nodePoint = resolveElementPoint(node);
		const parent = stack[stack.length - 1];
		if (parent && nodePoint && parent.firstChildPoint === undefined) {
			parent.firstChildPoint = nodePoint;
		}

		if (node.titleText !== undefined && node.name !== "svg") {
			const title = cleanTitle(node.titleText);
			const kks = pickMarkerKks(node.dynValues, title);
			const submodel = normalizeIdentity(getAttr(node.attrs, "xlink:href", "href"));

			markers.push({
				index: markers.length + 1,
				title,
				kks,
				submodel,
				isMismatch: isTitleMismatch(title, kks),
				tag: node.name,
				point: nodePoint ?? node.firstChildPoint,
			});
		}
	};

	parser.write(svgContent).close();

	return {
		markers,
		viewWidth,
		viewHeight,
	};
}

export function parseMarkers(svgContent: string): ParsedSvg {
	try {
		return parseMarkersWithSax(svgContent);
	} catch {
		const regex = /<([a-zA-Z_][a-zA-Z0-9:_-]*)([^>]*)>\s*<title>([\s\S]*?)<\/title>/g;
		const markers: RawMarker[] = [];
		let match = regex.exec(svgContent);
		while (match !== null) {
			const tag = match[1].toLowerCase();
			if (tag === "svg") {
				match = regex.exec(svgContent);
				continue;
			}
			markers.push({
				index: markers.length + 1,
				tag,
				title: cleanTitle(match[3]),
				kks: normalizeIdentity(match[3]),
				isMismatch: false,
			});
			match = regex.exec(svgContent);
		}
		const viewBoxMatch = svgContent.match(/\bviewBox=["']([^"']+)["']/i);
		const parsedViewBox = parseViewBox(viewBoxMatch?.[1]);
		return {
			markers,
			viewWidth: parsedViewBox.width,
			viewHeight: parsedViewBox.height,
		};
	}
}
