import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import path from "node:path";
import postgres from "postgres";
import { createClient } from "redis";
import { logger } from "./logger.mjs";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "127.0.0.1";
const shutdownTimeoutMs = Number.parseInt(
	process.env.SHUTDOWN_TIMEOUT_MS ?? "30000",
	10,
);
const healthcheckRedisRequired = process.env.HEALTHCHECK_REDIS_REQUIRED === "true";
const releaseId = process.env.RELEASE_ID ?? "dev";
const serverLogger = logger.child({ module: "http-server", releaseId });

const entryUrl = pathToFileURL(
	path.join(process.cwd(), "dist", "server", "server.js"),
).href;
const { default: serverEntry } = await import(entryUrl);

let isShuttingDown = false;
const sockets = new Set();

function getOrigin(requestHost) {
	return `http://${requestHost || `${host}:${port}`}`;
}

function createFetchRequest(req) {
	const origin = getOrigin(req.headers.host);
	const url = new URL(req.url ?? "/", origin);
	const headers = new Headers();

	for (const [key, value] of Object.entries(req.headers)) {
		if (value === undefined) {
			continue;
		}

		if (Array.isArray(value)) {
			for (const item of value) {
				headers.append(key, item);
			}
			continue;
		}

		headers.set(key, value);
	}

	const init = {
		method: req.method,
		headers,
	};

	if (req.method !== "GET" && req.method !== "HEAD") {
		init.body = Readable.toWeb(req);
		init.duplex = "half";
	}

	return new Request(url, init);
}

async function sendFetchResponse(nodeResponse, response) {
	nodeResponse.statusCode = response.status;
	nodeResponse.statusMessage = response.statusText;

	const setCookieValues = [];

	for (const [key, value] of response.headers.entries()) {
		if (key.toLowerCase() === "set-cookie") {
			setCookieValues.push(value);
			continue;
		}

		nodeResponse.setHeader(key, value);
	}

	if (setCookieValues.length > 0) {
		nodeResponse.setHeader("set-cookie", setCookieValues);
	}

	if (!response.body) {
		nodeResponse.end();
		return;
	}

	Readable.fromWeb(response.body).pipe(nodeResponse);
}

async function runReadinessChecks() {
	if (!process.env.DATABASE_URL) {
		throw new Error("DATABASE_URL is not configured.");
	}

	const sql = postgres(process.env.DATABASE_URL, {
		max: 1,
		prepare: false,
		idle_timeout: 1,
		connect_timeout: 5,
	});

	try {
		await sql`select 1`;
	} finally {
		await sql.end({ timeout: 1 });
	}

	if (process.env.REDIS_URL) {
		const redis = createClient({ url: process.env.REDIS_URL });

		try {
			await redis.connect();
			await redis.ping();
		} finally {
			if (redis.isOpen) {
				await redis.quit();
			}
		}
	} else if (healthcheckRedisRequired) {
		throw new Error("REDIS_URL is not configured.");
	}
}

function sendJson(nodeResponse, statusCode, payload) {
	nodeResponse.statusCode = statusCode;
	nodeResponse.setHeader("content-type", "application/json; charset=utf-8");
	nodeResponse.end(JSON.stringify(payload));
}

const server = createServer(async (req, res) => {
	if (!req.url) {
		sendJson(res, 400, { ok: false, error: "Missing request URL." });
		return;
	}

	if (req.url === "/healthz") {
		sendJson(res, 200, { ok: true, releaseId, status: "alive" });
		return;
	}

	if (req.url === "/readyz") {
		try {
			await runReadinessChecks();
			sendJson(res, 200, { ok: true, releaseId, status: "ready" });
		} catch (error) {
			serverLogger.warn({ err: error }, "Readiness check failed");
			sendJson(res, 503, {
				ok: false,
				releaseId,
				status: "not-ready",
				error: error instanceof Error ? error.message : "Unknown readiness error.",
			});
		}
		return;
	}

	if (isShuttingDown) {
		res.setHeader("connection", "close");
		sendJson(res, 503, { ok: false, error: "Server is shutting down." });
		return;
	}

	try {
		const request = createFetchRequest(req);
		const response = await serverEntry.fetch(request);
		await sendFetchResponse(res, response);
	} catch (error) {
		serverLogger.error(
			{ err: error, method: req.method, url: req.url },
			"Unhandled server error",
		);
		sendJson(res, 500, { ok: false, error: "Internal server error." });
	}
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

server.on("connection", (socket) => {
	sockets.add(socket);
	socket.on("close", () => sockets.delete(socket));

	if (isShuttingDown) {
		socket.destroy();
	}
});

function shutdown(signal) {
	if (isShuttingDown) {
		return;
	}

	isShuttingDown = true;
	serverLogger.info(
		{ signal, shutdownTimeoutMs },
		"Starting graceful shutdown",
	);

	server.close((error) => {
		if (error) {
			serverLogger.error({ err: error }, "Error while closing HTTP server");
			process.exit(1);
		}

		serverLogger.info("HTTP server closed");
		process.exit(0);
	});

	for (const socket of sockets) {
		socket.end();
	}

	setTimeout(() => {
		for (const socket of sockets) {
			socket.destroy();
		}

		serverLogger.warn("Graceful shutdown timed out; destroying open sockets");
		process.exit(1);
	}, shutdownTimeoutMs).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.listen(port, host, () => {
	serverLogger.info(
		{ host, port, url: `http://${host}:${port}` },
		"Spider Viewer listening",
	);
});
