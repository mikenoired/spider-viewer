import postgres from "postgres";
import { createClient } from "redis";

import { backupDatabase } from "./backup-db";

export async function clearHistory(
	sql: ReturnType<typeof postgres>,
	execute: boolean,
	backup = backupDatabase,
	options: { resetWorkState?: boolean } = {}
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
		const workState = options.resetWorkState
			? (
					await tx`select
				(select count(*)::int from priority_room_lists) as lists,
				(select count(*)::int from remarks) as remarks,
				(select count(*)::int from notifications) as notifications,
				(select count(*)::int from cables where progress <> 0) as progressed_cables,
				(select count(*)::int from graph_group_rooms where progress <> 0) as progressed_rooms,
				(select count(*)::int from installation_kks_items where is_done) as completed_installation_items`
				)[0]
			: undefined;
		if (!execute) return { execute: false, counts, workState };
		const [{ snapshot }] = await tx`select pg_export_snapshot() as snapshot`;
		const savedBackup = await backup(snapshot);
		await tx`delete from notifications where remark_id in (select id from remarks where target_type in ('room_change', 'cable_change'))`;
		await tx`delete from remark_cable_items where remark_id in (select id from remarks where target_type in ('room_change', 'cable_change'))`;
		await tx`delete from remarks where target_type in ('room_change', 'cable_change')`;
		await tx`delete from change_audit_logs`;
		await tx`delete from cable_change_audit_logs`;
		await tx`delete from task_events`;
		if (options.resetWorkState) {
			await tx`delete from notifications`;
			await tx`delete from remark_cable_items`;
			await tx`delete from remarks`;
			await tx`delete from task_comments`;
			await tx`delete from cable_list_items`;
			await tx`delete from priority_room_entries`;
			await tx`delete from priority_room_kanban_states`;
			await tx`delete from priority_room_lists`;
			await tx`delete from cable_progress`;
			await tx`delete from installation_pending_changes`;
			await tx`update cables set progress=0, progress_updated_by_user_id=null, progress_updated_at=null, updated_at=now()
				where progress<>0 or progress_updated_by_user_id is not null or progress_updated_at is not null`;
			await tx`update graph_group_rooms set progress=0, effective_date=null, updated_by_user_id=null, updated_at=now()
				where progress<>0 or effective_date is not null or updated_by_user_id is not null`;
			await tx`update installation_kks_items set is_done=false, revision=revision+1, updated_by_user_id=null, updated_at=now()`;
		}
		return { execute: true, counts, workState, backup: savedBackup };
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
		if (args.some((arg) => !["--execute", "--maintenance-confirmed", "--reset-work-state"].includes(arg)))
			throw new Error("Unknown argument.");
		if (args.includes("--execute") && !args.includes("--maintenance-confirmed"))
			throw new Error("Stop application writers before executing history cleanup.");
		if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
		sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 15 });
		const result = await clearHistory(sql, args.includes("--execute"), backupDatabase, {
			resetWorkState: args.includes("--reset-work-state"),
		});
		committed = result.execute;
		process.stdout.write(`${JSON.stringify(result)}\n`);
		if (committed) await clearAuditCache();
	} catch {
		process.stderr.write(
			committed
				? "Data cleanup committed, but Redis cleanup failed. Retry Redis cleanup with bun run db:clear-audit-cache."
				: "No reset was committed. Check DATABASE_URL, lock conflicts, pg_dump and S3 configuration. Usage: bun run db:clear-history [--reset-work-state] [--execute --maintenance-confirmed]\n"
		);
		process.exitCode = 1;
	} finally {
		await sql?.end();
	}
}
