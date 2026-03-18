import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
	var __spiderViewerSql__: ReturnType<typeof postgres> | undefined;
	var __spiderViewerDb__: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

function getDatabaseUrl() {
	const databaseUrl = process.env.DATABASE_URL;

	if (!databaseUrl) {
		throw new Error("DATABASE_URL is not configured.");
	}

	return databaseUrl;
}

function getSqlClient() {
	if (!globalThis.__spiderViewerSql__) {
		globalThis.__spiderViewerSql__ = postgres(getDatabaseUrl(), {
			prepare: false,
		});
	}

	return globalThis.__spiderViewerSql__;
}

export function getDb() {
	if (!globalThis.__spiderViewerDb__) {
		globalThis.__spiderViewerDb__ = drizzle(getSqlClient(), {
			schema,
		});
	}

	return globalThis.__spiderViewerDb__;
}

export async function closeDbConnection() {
	if (globalThis.__spiderViewerSql__) {
		await globalThis.__spiderViewerSql__.end();
		globalThis.__spiderViewerSql__ = undefined;
		globalThis.__spiderViewerDb__ = undefined;
	}
}
