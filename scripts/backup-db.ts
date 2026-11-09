import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getBackupPrefix, getStorageClient } from "./storage";

async function runPgDump(path: string, snapshot?: string) {
	const url = new URL(process.env.DATABASE_URL || "");
	if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Invalid DATABASE_URL.");
	const args = ["--format=custom", "--no-owner", "--no-acl", `--file=${path}`];
	if (snapshot) args.push(`--snapshot=${snapshot}`);
	// libpq parameters stay out of process arguments and logs; never print stderr with credentials.
	const child = Bun.spawn([process.env.PG_DUMP_PATH || "pg_dump", ...args], {
		env: {
			...process.env,
			PGHOST: url.hostname,
			PGPORT: url.port || "5432",
			PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
			PGUSER: decodeURIComponent(url.username),
			PGPASSWORD: decodeURIComponent(url.password),
			PGSSLMODE: url.searchParams.get("sslmode") || process.env.PGSSLMODE || "prefer",
			PGCONNECT_TIMEOUT: "15",
		},
		stdout: "ignore",
		stderr: "ignore",
		timeout: 30 * 60 * 1000,
	});
	const code = await child.exited;
	if (code !== 0)
		throw new Error(`pg_dump failed (exit ${code}); check connectivity and client/server versions.`);
}

export async function sha256File(path: string) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

export async function backupDatabase(snapshot?: string) {
	const storage = getStorageClient();
	const prefix = getBackupPrefix();
	const directory = await mkdtemp(join(tmpdir(), "spider-backup-"));
	const path = join(directory, "database.dump");
	const key = `${prefix}${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.dump`;
	try {
		await runPgDump(path, snapshot);
		const file = Bun.file(path);
		if (file.size === 0) throw new Error("pg_dump produced an empty backup.");
		const sha256 = await sha256File(path);
		await storage.write(key, file, { type: "application/octet-stream" });
		if ((await storage.stat(key)).size !== file.size) throw new Error("Uploaded backup size mismatch.");
		const downloaded = join(directory, "verify.dump");
		await Bun.write(downloaded, storage.file(key));
		if ((await sha256File(downloaded)) !== sha256) throw new Error("Uploaded backup checksum mismatch.");
		await storage.write(
			`${key}.json`,
			JSON.stringify({ key, sha256, bytes: file.size, createdAt: new Date().toISOString() }),
			{
				type: "application/json",
			}
		);
		return { key, sha256, bytes: file.size };
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

export async function pruneBackups(now = new Date()) {
	const days = Number(process.env.DB_BACKUP_RETENTION_DAYS || 30);
	if (!Number.isInteger(days) || days < 1)
		throw new Error("DB_BACKUP_RETENTION_DAYS must be a positive integer.");
	const prefix = getBackupPrefix();
	const storage = getStorageClient();
	const cutoff = now.getTime() - days * 86_400_000;
	let startAfter: string | undefined;
	let more = true;
	while (more) {
		const page = await storage.list({ prefix, startAfter });
		for (const object of page.contents || []) {
			if (
				object.key?.endsWith(".dump") &&
				object.lastModified &&
				new Date(object.lastModified).getTime() < cutoff
			) {
				await storage.delete(object.key);
				await storage.delete(`${object.key}.json`);
			}
		}
		more = Boolean(page.isTruncated);
		if (!more) break;
		const next = page.contents?.at(-1)?.key;
		if (!next || next === startAfter) throw new Error("S3 pagination did not advance.");
		startAfter = next;
	}
}

if (import.meta.main) {
	try {
		process.stdout.write(`${JSON.stringify(await backupDatabase())}\n`);
		await pruneBackups();
	} catch {
		process.stderr.write(
			"Database backup failed; no cleanup should be performed. Check PostgreSQL, pg_dump, S3 configuration and available disk space.\n"
		);
		process.exitCode = 1;
	}
}
