import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

const enToRuMap: Record<string, string> = {
	A: "А",
	a: "а",
	B: "В",
	b: "ь",
	C: "С",
	c: "с",
	E: "Е",
	e: "е",
	K: "К",
	k: "к",
	M: "М",
	m: "м",
	H: "Н",
	h: "н",
	O: "О",
	o: "о",
	P: "Р",
	p: "р",
	T: "Т",
	t: "т",
	Y: "У",
	y: "у",
	X: "Х",
	x: "х",
};

export function enToRuVisual(text: string) {
	return text
		.split("")
		.map((char) => enToRuMap[char] ?? char)
		.join("");
}
