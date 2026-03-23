export function getTodayIsoInMoscow(date = new Date()) {
	return new Intl.DateTimeFormat("sv-SE", {
		timeZone: "Europe/Moscow",
	}).format(date)
}

function sanitizeFileNamePart(value: string) {
	return value
		.trim()
		.replace(/[<>:"/\\|?*]/g, "")
		.split("")
		.filter(char => char.charCodeAt(0) >= 32)
		.join("")
		.replace(/\s+/g, "_")
}

export function buildDailyHistoryReportFileName(level?: string | null) {
	const dateLabel = getTodayIsoInMoscow()
	const levelLabel = level ? sanitizeFileNamePart(level) : null

	return levelLabel
		? `daily-history-level-${levelLabel}-${dateLabel}.docx`
		: `daily-history-${dateLabel}.docx`
}
