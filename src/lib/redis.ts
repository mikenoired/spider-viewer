import { createClient } from "redis"

type SpiderViewerRedisClient = ReturnType<typeof createClient>

declare global {
	var __spiderViewerRedis__: SpiderViewerRedisClient | undefined
	var __spiderViewerRedisConnectPromise__: Promise<SpiderViewerRedisClient> | undefined
}

function getRedisUrl() {
	return process.env.REDIS_URL ?? "redis://localhost:6379/0"
}

async function connectRedisClient() {
	if (globalThis.__spiderViewerRedis__?.isOpen) {
		return globalThis.__spiderViewerRedis__
	}

	if (!globalThis.__spiderViewerRedis__) {
		const client = createClient({
			url: getRedisUrl(),
		})

		client.on("error", error => {
			console.error("Redis error:", error)
		})

		globalThis.__spiderViewerRedis__ = client
	}

	if (!globalThis.__spiderViewerRedisConnectPromise__) {
		const client = globalThis.__spiderViewerRedis__

		if (!client) {
			throw new Error("Redis client is not initialized.")
		}

		globalThis.__spiderViewerRedisConnectPromise__ = client
			.connect()
			.then(() => client)
			.finally(() => {
				globalThis.__spiderViewerRedisConnectPromise__ = undefined
			})
	}

	return globalThis.__spiderViewerRedisConnectPromise__
}

export async function getRedis() {
	return connectRedisClient()
}

export async function closeRedisConnection() {
	if (globalThis.__spiderViewerRedis__?.isOpen) {
		await globalThis.__spiderViewerRedis__.quit()
	}

	globalThis.__spiderViewerRedis__ = undefined
	globalThis.__spiderViewerRedisConnectPromise__ = undefined
}
