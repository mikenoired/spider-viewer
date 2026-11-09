import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createClient } from "redis";

import { backupDatabase, pruneBackups } from "../../scripts/backup-db";
import { clearAuditCache, clearHistory } from "../../scripts/clear-history";
import { getStorageClient } from "../../scripts/storage";
import * as schema from "../../src/lib/db/schema";
import { archiveInstallationPhoto } from "../../src/lib/installation-photo/uploads.server";
import { archiveUpload } from "../../src/lib/uploads.server";

const url = process.env.STORAGE_TEST_DATABASE_URL;
describe.skipIf(!url)("storage and history maintenance on disposable PostgreSQL", () => {
	let db: ReturnType<typeof postgres>;
	const userId = randomUUID(),
		cableId = randomUUID(),
		listId = randomUUID(),
		changeId = randomUUID(),
		remarkId = randomUUID();
	beforeAll(async () => {
		if (!url || !/test/i.test(new URL(url).pathname) || url === process.env.DATABASE_URL)
			throw new Error("Separate test database required");
		if (process.env.STORAGE_TEST_S3 && process.env.S3_BACKUP_PREFIX !== "backups/storage-test/")
			throw new Error("S3 tests require isolated backups/storage-test/ prefix.");
		db = postgres(url, { max: 4, prepare: false, onnotice: () => {} });
		await db`truncate users cascade`;
		await db`insert into users(id,login,password_hash) values (${userId},'storage-test','unused')`;
		await db`insert into cables(id,external_key,cable_label,progress) values (${cableId},'storage-test','Test',75)`;
		await db`insert into priority_room_lists(id,author_name,file_name,file_type,imported_by_user_id) values (${listId},'test','test.xlsx','xlsx',${userId})`;
		await db`insert into task_events(list_id,event_type,message) values (${listId},'created','test')`;
		await db`insert into task_comments(list_id,content,created_by_user_id) values (${listId},'preserve',${userId})`;
		await db`insert into cable_change_audit_logs(id,room_name,cable_label,user_id,user_login,effective_date,old_progress,new_progress) values (${changeId},'test','Test',${userId},'storage-test','2026-01-01',0,75)`;
		await db`insert into change_audit_logs(room_name,user_id,user_login,effective_date,old_progress,new_progress) values ('test',${userId},'storage-test','2026-01-01',0,75)`;
		await db`insert into remarks(id,target_type,target_id,content,created_by_user_id) values (${remarkId},'cable_change',${changeId},'remove',${userId})`;
		await db`insert into remark_cable_items(remark_id,cable_id) values (${remarkId},${cableId})`;
		await db`insert into remarks(target_type,target_id,content,created_by_user_id) values ('cable',${cableId},'preserve',${userId})`;
		await db`insert into notifications(user_id,remark_id,type,message,dedupe_key) values (${userId},${remarkId},'remark','remove','storage-remove')`;
		await db`insert into notifications(user_id,type,message,dedupe_key) values (${userId},'task','preserve','storage-keep')`;
	});
	afterAll(async () => {
		globalThis.__spiderViewerDb__ = undefined;
		await db?.end();
	});
	it("preview and failed backup preserve data; successful cleanup preserves live state and is repeatable", async () => {
		const preview = await clearHistory(db, false);
		expect(preview.counts).toEqual({ rooms: 1, cables: 1, events: 1, remarks: 1 });
		await expect(
			clearHistory(db, true, async () => {
				throw new Error("S3 unavailable");
			})
		).rejects.toThrow("S3 unavailable");
		expect((await clearHistory(db, false)).counts).toEqual(preview.counts);
		const result = await clearHistory(db, true, async () => ({
			key: "verified-test-backup",
			sha256: "test",
			bytes: 1,
		}));
		expect(result.execute).toBe(true);
		expect((await clearHistory(db, false)).counts).toEqual({ rooms: 0, cables: 0, events: 0, remarks: 0 });
		expect((await db`select progress from cables where id=${cableId}`)[0].progress).toBe(75);
		for (const table of ["users", "priority_room_lists", "task_comments", "remarks", "notifications"])
			expect((await db`select count(*)::int as n from ${db(table)}`)[0].n).toBe(1);
		expect((await db`select count(*)::int as n from remark_cable_items`)[0].n).toBe(0);
		expect(
			(await clearHistory(db, true, async () => ({ key: "repeat", sha256: "test", bytes: 1 }))).counts.events
		).toBe(0);
	});
	it("includes a writer committed while cleanup waits for its table lock", async () => {
		const { promise: ready, resolve: markReady } = Promise.withResolvers<void>();
		const { promise: release, resolve: releaseWriter } = Promise.withResolvers<void>();
		const writer = db.begin(async (tx) => {
			await tx`insert into task_events(list_id,event_type,message) values (${listId},'created','concurrent')`;
			markReady();
			await release;
		});
		await ready;
		const cleanup = clearHistory(db, true, async () => ({ key: "concurrent", sha256: "test", bytes: 1 }));
		try {
			const deadline = Date.now() + 5000;
			let waiting = false;
			while (Date.now() < deadline) {
				const [row] =
					await db`select exists(select 1 from pg_locks where relation='task_events'::regclass and not granted) as waiting`;
				if (row.waiting) {
					waiting = true;
					break;
				}
				await Bun.sleep(10);
			}
			expect(waiting).toBe(true);
		} finally {
			releaseWriter();
		}
		await writer;
		expect((await cleanup).counts.events).toBe(1);
		expect((await clearHistory(db, false)).counts.events).toBe(0);
	});
	it.skipIf(!process.env.STORAGE_TEST_REDIS_URL)("deletes only the two audit keys", async () => {
		const old = process.env.REDIS_URL;
		process.env.REDIS_URL = process.env.STORAGE_TEST_REDIS_URL;
		const redis = createClient({ url: process.env.STORAGE_TEST_REDIS_URL });
		await redis.connect();
		try {
			await redis.set("spider-viewer:audit", "old");
			await redis.set("spider-viewer:audit:backdated", "old");
			await redis.set("storage-test:preserve", "keep");
			await clearAuditCache();
			expect(await redis.exists(["spider-viewer:audit", "spider-viewer:audit:backdated"])).toBe(0);
			expect(await redis.get("storage-test:preserve")).toBe("keep");
		} finally {
			await redis.del("storage-test:preserve");
			redis.destroy();
			if (old === undefined) delete process.env.REDIS_URL;
			else process.env.REDIS_URL = old;
		}
	});
	it.skipIf(!process.env.STORAGE_TEST_S3)(
		"archives byte-identical originals and verifies a real pg_dump round trip",
		async () => {
			const oldUrl = process.env.DATABASE_URL;
			const oldEnabled = process.env.S3_UPLOADS_ENABLED;
			process.env.DATABASE_URL = url;
			process.env.S3_UPLOADS_ENABLED = "true";
			globalThis.__spiderViewerDb__ = drizzle(db, { schema });
			try {
				const file = new File(["original workbook bytes"], "test.xlsx");
				const key = await archiveUpload(file, userId, "test");
				expect(key).toBeTruthy();
				expect(await getStorageClient().file(key!).text()).toBe(await file.text());
				expect((await db`select file_name from uploaded_files where object_key=${key!}`)[0].file_name).toBe(
					"test.xlsx"
				);
				const photoSnapshot = randomUUID();
				await db`insert into installation_snapshots(id,file_name,file_type,checksum,imported_by_user_id) values (${photoSnapshot},'test.xlsx','xlsx','test',${userId})`;
				const photoData = new FormData();
				photoData.set("userId", userId);
				photoData.set("snapshotId", photoSnapshot);
				photoData.set("file", new File(["photo bytes"], "photo.jpg", { type: "image/jpeg" }));
				const photo = await archiveInstallationPhoto(photoData, {
					id: userId,
					login: "storage-test",
					role: "super-admin",
					department: "tai",
				});
				expect(await getStorageClient().file(photo.key!).text()).toBe("photo bytes");
				const backup = await backupDatabase();
				expect(backup.bytes).toBeGreaterThan(0);
				expect((await getStorageClient().file(`${backup.key}.json`).json()).sha256).toBe(backup.sha256);
				const directory = await mkdtemp(join(tmpdir(), "spider-download-test-"));
				try {
					const path = join(directory, "database.dump");
					const runDownload = () =>
						Bun.spawn(["bun", "scripts/download-backup.ts", backup.key, path], {
							stdout: "ignore",
							stderr: "ignore",
						}).exited;
					expect(await runDownload()).toBe(0);
					expect((await stat(path)).mode & 0o777).toBe(0o600);
					expect(await runDownload()).toBe(1);
					expect(Bun.file(path).size).toBe(backup.bytes);
				} finally {
					await rm(directory, { recursive: true, force: true });
				}
				// Export a consistent snapshot inside cleanup too: pg_dump must not deadlock on the locks.
				expect((await clearHistory(db, true)).execute).toBe(true);
				await pruneBackups(new Date(Date.now() + 31 * 86_400_000));
				expect(await getStorageClient().exists(backup.key)).toBe(false);
				expect(await getStorageClient().exists(`${backup.key}.json`)).toBe(false);
				expect(await getStorageClient().exists(key!)).toBe(true);
			} finally {
				if (oldUrl === undefined) delete process.env.DATABASE_URL;
				else process.env.DATABASE_URL = oldUrl;
				if (oldEnabled === undefined) delete process.env.S3_UPLOADS_ENABLED;
				else process.env.S3_UPLOADS_ENABLED = oldEnabled;
				globalThis.__spiderViewerDb__ = undefined;
			}
		}
	);
	it("resets the visible work state while preserving accounts, imported maps and cables", async () => {
		const snapshotId = randomUUID(),
			groupId = randomUUID(),
			roomId = randomUUID(),
			rowId = randomUUID();
		await db`insert into import_snapshots(id,file_name,file_type,checksum,imported_by_user_id,is_active) values (${snapshotId},'map.xlsx','xlsx','map-test',${userId},true)`;
		await db`insert into graph_groups(id,snapshot_id,group_key,graph_side,source_zone,level) values (${groupId},${snapshotId},'dirty:none:test:0','dirty','test','0')`;
		await db`insert into graph_group_rooms(id,snapshot_id,group_id,room_name,room_role,progress,updated_by_user_id) values (${roomId},${snapshotId},${groupId},'room','primary',75,${userId})`;
		await db`insert into imported_cable_rows(id,cable_id,snapshot_id,source_row_index,cable_label,graph_side,from_room,from_zone,level) values (${rowId},${cableId},${snapshotId},1,'Test','dirty','room','test','0')`;
		await db`insert into cable_progress(snapshot_id,group_id,room_id,cable_row_id,progress) values (${snapshotId},${groupId},${roomId},${rowId},75)`;
		await db`insert into cable_list_items(list_id,cable_id) values (${listId},${cableId})`;
		await db`insert into priority_room_entries(list_id,snapshot_id,room_name,normalized_room_name) values (${listId},${snapshotId},'room','room')`;
		await db`insert into priority_room_kanban_states(snapshot_id,room_id,updated_by_user_id,status) values (${snapshotId},${roomId},${userId},'done')`;
		const installationId = randomUUID(),
			installationGroup = randomUUID(),
			installationItem = randomUUID();
		await db`insert into installation_snapshots(id,file_name,file_type,checksum,imported_by_user_id) values (${installationId},'board.xlsx','xlsx','board-test',${userId})`;
		await db`insert into installation_kks_groups(id,snapshot_id,name) values (${installationGroup},${installationId},'group')`;
		await db`insert into installation_kks_items(id,snapshot_id,group_id,name,is_done,revision) values (${installationItem},${installationId},${installationGroup},'KKS',true,3)`;
		await db`insert into installation_pending_changes(client_mutation_id,snapshot_id,group_id,kks_item_id,user_id,user_login,base_done,desired_done,server_done) values ('reset-pending',${installationId},${installationGroup},${installationItem},${userId},'storage-test',false,true,true)`;
		globalThis.__spiderViewerDb__ = drizzle(db, { schema });
		const { getActiveDashboardData, getHistoryEntries } =
			await import("../../src/lib/cable-map/queries.server");
		expect((await getActiveDashboardData()).snapshot?.averageProgress).toBe(75);
		const backup = async () => ({ key: "verified-work-reset", sha256: "test", bytes: 1 });
		await clearHistory(db, false, backup, { resetWorkState: true });
		expect((await getActiveDashboardData()).priorityLists.length).toBe(1);
		await expect(
			clearHistory(
				db,
				true,
				async () => {
					throw new Error("backup offline");
				},
				{ resetWorkState: true }
			)
		).rejects.toThrow("backup offline");
		expect((await getActiveDashboardData()).snapshot?.averageProgress).toBe(75);
		await db.unsafe(
			"create function work_reset_fail() returns trigger language plpgsql as $$ begin raise exception 'injected reset failure'; end $$"
		);
		await db.unsafe(
			"create trigger work_reset_fail before update on cables for each statement execute function work_reset_fail()"
		);
		try {
			await expect(clearHistory(db, true, backup, { resetWorkState: true })).rejects.toThrow(
				"injected reset failure"
			);
			expect((await getActiveDashboardData()).priorityLists.length).toBe(1);
			expect((await getActiveDashboardData()).snapshot?.averageProgress).toBe(75);
			expect((await db`select count(*)::int as n from installation_pending_changes`)[0].n).toBe(1);
		} finally {
			await db.unsafe("drop trigger work_reset_fail on cables");
			await db.unsafe("drop function work_reset_fail()");
		}
		await clearHistory(db, true, backup, { resetWorkState: true });
		const page = await getActiveDashboardData();
		expect(page.priorityLists).toEqual([]);
		expect(page.snapshot?.averageProgress).toBe(0);
		expect(page.snapshot?.id).toBe(snapshotId);
		expect(await getHistoryEntries()).toEqual([]);
		for (const table of [
			"remarks",
			"remark_cable_items",
			"notifications",
			"task_comments",
			"task_events",
			"cable_list_items",
			"priority_room_lists",
			"priority_room_entries",
			"priority_room_kanban_states",
			"cable_progress",
			"installation_pending_changes",
		])
			expect((await db`select count(*)::int as n from ${db(table)}`)[0].n).toBe(0);
		expect((await db`select progress from cables where id=${cableId}`)[0].progress).toBe(0);
		expect(
			(await db`select is_done,revision from installation_kks_items where id=${installationItem}`)[0]
		).toMatchObject({ is_done: false, revision: 4 });
		expect((await db`select password_hash from users where id=${userId}`)[0].password_hash).toBe("unused");
		expect((await db`select count(*)::int as n from imported_cable_rows where id=${rowId}`)[0].n).toBe(1);
		globalThis.__spiderViewerDb__ = undefined;
	});
});
