export type ProcessBatchOptions = {
	inputDir: string;
	outputDir: string;
	concurrency: number;
	match?: string;
	limit?: number;
};

export type BatchProgress = {
	completed: number;
	total: number;
	success: number;
	failed: number;
	totalMarkers: number;
	totalMismatches: number;
	line: string;
};

export type BatchResult = {
	success: number;
	failed: number;
	totalMarkers: number;
	totalMismatches: number;
	logFilePath?: string;
	summary: string;
};

export type LoggerLike = {
	log(message: string): void;
};

export type Point = {
	x: number;
	y: number;
};

export type RawMarker = {
	index: number;
	title: string;
	kks?: string;
	submodel?: string;
	description?: string;
	isMismatch: boolean;
	tag: string;
	point?: Point;
};

export type RenderedMarker = {
	index: number;
	title: string;
	kks?: string;
	submodel?: string;
	description?: string;
	isMismatch: boolean;
	x: number;
	y: number;
};

export type ParsedSvg = {
	markers: RawMarker[];
	viewWidth?: number;
	viewHeight?: number;
};
