import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

const enToRuMap = new Map([
  ["A", "А"],
  ["a", "а"],
  ["B", "В"],
  ["b", "ь"],
  ["C", "С"],
  ["c", "с"],
  ["E", "Е"],
  ["e", "е"],
  ["K", "К"],
  ["k", "к"],
  ["M", "М"],
  ["m", "м"],
  ["H", "Н"],
  ["h", "н"],
  ["O", "О"],
  ["o", "о"],
  ["P", "Р"],
  ["p", "р"],
  ["T", "Т"],
  ["t", "т"],
  ["Y", "У"],
  ["y", "у"],
  ["X", "Х"],
  ["x", "х"],
])

export const enToRuVisual = (text: string) =>
  text.replace(/./g, char => enToRuMap.get(char) ?? char)

export async function downloadResponseFile(response: Response, fileName: string) {
	const blob = await response.blob()
	const objectUrl = URL.createObjectURL(blob)
	const link = document.createElement("a")
	link.href = objectUrl
	link.download = fileName
	link.click()
	URL.revokeObjectURL(objectUrl)
}
