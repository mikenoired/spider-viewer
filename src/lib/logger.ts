import pino from "pino"

const LOG_LEVELS = new Set(["fatal", "error", "warn", "info", "debug", "trace", "silent"])

function getLogLevel() {
	const configuredLevel = process.env.LOG_LEVEL?.trim().toLowerCase()

	if (configuredLevel && LOG_LEVELS.has(configuredLevel)) {
		return configuredLevel
	}

	return process.env.NODE_ENV === "production" ? "info" : "debug"
}

export const logger = pino({
	name: "spider-viewer",
	level: getLogLevel(),
	timestamp: pino.stdTimeFunctions.isoTime,
})

export function createLogger(bindings: pino.Bindings) {
	return logger.child(bindings)
}
