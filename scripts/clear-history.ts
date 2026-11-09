import postgres from "postgres";
import { createClient } from "redis";

import { backupDatabase } from "./backup-db";

export async function clearHistory(
	sql: ReturnType<typeof postgres>,
	execute: boolean,
	backup = backupDatabase
) {
	const tables = execute
		? await sql<
				{ tablename: string }[]
			>`select tablename from pg_tables where schemaname = 'public' order by tablename`
		: [];
	return sql.begin("isolation level repeatable read", async (tx) => {
		await tx`set local lock_timeout = '15s'`;
		if (execute) {
			// Block writers while pg_dump reads the same exported snapshot. Reads remain available.
			for (const { tablename } of tables)
				await tx`lock table ${tx("public")}.${tx(tablename)} in share row exclusive mode`;
		}
		const [counts] = await tx`
			select (select count(*)::int from change_audit_logs) as rooms,
			(select count(*)::int from cable_change_audit_logs) as cables,
			(select count(*)::int from task_events) as events,
			(select count(*)::int from remarks where target_type in ('room_change', 'cable_change')) as remarks`;
		if (!execute) return { execute: false, counts };
		const [{ snapshot }] = await tx`select pg_export_snapshot() as snapshot`;
		const savedBackup = await backup(snapshot);
		await tx`delete from notifications where remark_id in (select id from remarks where target_type in ('room_change', 'cable_change'))`;
		await tx`delete from remark_cable_items where remark_id in (select id from remarks where target_type in ('room_change', 'cable_change'))`;
		await tx`delete from remarks where target_type in ('room_change', 'cable_change')`;
		await tx`delete from change_audit_logs`;
		await tx`delete from cable_change_audit_logs`;
		await tx`delete from task_events`;
		return { execute: true, counts, backup: savedBackup };
	});
}

export async function clearAuditCache() {
	if (!process.env.REDIS_URL) return;
	const redis = createClient({
		url: process.env.REDIS_URL,
		socket: { connectTimeout: 5000, reconnectStrategy: false },
	});
	redis.on("error", () => {});
	try {
		await redis.connect();
		await redis.del(["spider-viewer:audit", "spider-viewer:audit:backdated"]);
	} finally {
		if (redis.isOpen) redis.destroy();
	}
}

if (import.meta.main) {
	let committed = false;
	let sql: ReturnType<typeof postgres> | undefined;
	try {
		const args = process.argv.slice(2);
		if (args.some((arg) => !["--execute", "--maintenance-confirmed"].includes(arg)))
			throw new Error("Unknown argument.");
		if (args.includes("--execute") && !args.includes("--maintenance-confirmed"))
			throw new Error("Stop application writers before executing history cleanup.");
		if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
		sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 15 });
		const result = await clearHistory(sql, args.includes("--execute"));
		committed = result.execute;
		process.stdout.write(`${JSON.stringify(result)}\n`);
		if (committed) await clearAuditCache();
	} catch {
		process.stderr.write(
			committed
				? "History deletion committed, but Redis cleanup failed. Retry Redis cleanup with bun run db:clear-audit-cache."
				: "History was not deleted. Check DATABASE_URL, lock conflicts, pg_dump and S3 configuration. Usage: bun run db:clear-history [--execute --maintenance-confirmed]\n"
		);
		process.exitCode = 1;
	} finally {
		await sql?.end();
	}
}
