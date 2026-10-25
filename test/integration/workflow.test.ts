import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as Xlsx from "xlsx";

import type { AuthSession } from "@/lib/auth/shared";
import { saveCableProgressChanges } from "@/lib/cable-map/history.server";
import { ensureCanonicalCableBase, importWorkbookFromFormData } from "@/lib/cable-map/import.server";
import { getRemarksData } from "@/lib/cable-map/remarks.server";
import { importCableTaskListFromFormData, transitionKanbanTask } from "@/lib/cable-map/task-workflow.server";
import * as schema from "@/lib/db/schema";
import {
	applyInstallationPendingGroup,
	saveInstallationKksState,
	submitInstallationOfflineChanges,
} from "@/lib/installation/mutations.server";
import { getActiveInstallationBoardData } from "@/lib/installation/queries.server";

const originalRedisUrl = process.env.REDIS_URL;
const testUrl = process.env.APP_TEST_DATABASE_URL;
describe.skipIf(!testUrl)("workflow regressions with real PostgreSQL", () => {
	let client: ReturnType<typeof postgres>;
	let db: ReturnType<typeof drizzle<typeof schema>>;
	const master: AuthSession = { id: randomUUID(), login: "master", role: "super-admin", department: "tai" };
	const skm: AuthSession = { id: randomUUID(), login: "skm", role: "user", department: "skm" };
	const other: AuthSession = { id: randomUUID(), login: "other", role: "user", department: "skm" };
	const commissioning: AuthSession = {
		id: randomUUID(),
		login: "commissioning",
		role: "user",
		department: "commissioning",
	};
	let statements = 0;

	beforeAll(() => {
		delete process.env.REDIS_URL;
		if (!testUrl || testUrl === process.env.DATABASE_URL || !/test/i.test(new URL(testUrl).pathname)) {
			throw new Error("APP_TEST_DATABASE_URL must name a separate disposable test database.");
		}
		client = postgres(testUrl, { prepare: false, max: 4, onnotice: () => undefined });
		db = drizzle(client, {
			schema,
			logger: {
				logQuery() {
					statements++;
				},
			},
		});
		globalThis.__spiderViewerDb__ = db;
	});
	beforeEach(async () => {
		await db.execute(sql`truncate table users cascade`);
		await db
			.insert(schema.users)
			.values([master, skm, other, commissioning].map((user) => ({ ...user, passwordHash: "unused" })));
	});
	afterAll(async () => {
		globalThis.__spiderViewerDb__ = undefined;
		if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
		else process.env.REDIS_URL = originalRedisUrl;
		if (client) await client.end();
	});

	async function list(status: "formed" | "adjustment" = "formed") {
		return (
			await db
				.insert(schema.priorityRoomLists)
				.values({
					authorName: "test",
					fileName: "test.xlsx",
					fileType: "xlsx",
					importedByUserId: master.id,
					status,
				})
				.returning()
		)[0];
	}
	async function installation() {
		const [snapshot] = await db
			.insert(schema.installationSnapshots)
			.values({
				fileName: "test.xlsx",
				fileType: "xlsx",
				checksum: randomUUID(),
				importedByUserId: master.id,
				isActive: true,
			})
			.returning();
		const [group] = await db
			.insert(schema.installationKksGroups)
			.values({ snapshotId: snapshot.id, name: "group", kksCount: 1 })
			.returning();
		const [item] = await db
			.insert(schema.installationKksItems)
			.values({ snapshotId: snapshot.id, groupId: group.id, name: "1HV44K190" })
			.returning();
		return { snapshot, group, item };
	}

	async function contend<T>(
		table: "priority_room_lists" | "installation_kks_items",
		start: () => Promise<T>
	) {
		let unlock!: () => void;
		let acquired!: () => void;
		const ready = new Promise<void>((resolve) => {
			acquired = resolve;
		});
		const release = new Promise<void>((resolve) => {
			unlock = resolve;
		});
		const barrier = client.begin(async (tx) => {
			await tx.unsafe(`lock table "${table}" in share mode`);
			acquired();
			await release;
		});
		await ready;
		const outcome = start();
		let blocked = 0;
		try {
			for (let attempt = 0; attempt < 200; attempt++) {
				const [row] = await client`select count(*)::int as count from pg_stat_activity
					where datname = current_database() and wait_event_type = 'Lock'
					and position(${`update "${table}"`} in query) > 0`;
				blocked = row.count;
				if (blocked === 2) break;
				await Bun.sleep(10);
			}
		} finally {
			unlock();
			await barrier;
		}
		expect(blocked).toBe(2);
		return outcome;
	}

	it("rejects an unauthorized commissioning destination but permits finishing", async () => {
		const card = await list("adjustment");
		await expect(
			transitionKanbanTask({ listId: card.id, action: "move", status: "formed" }, commissioning)
		).rejects.toThrow(/недоступен/);
		await expect(
			transitionKanbanTask({ listId: card.id, action: "move", status: "done" }, commissioning)
		).resolves.toMatchObject({ status: "done" });
	});

	it("only one of two simultaneous accept calls acquires responsibility", async () => {
		const card = await list();
		const outcomes = await contend("priority_room_lists", () =>
			Promise.allSettled(
				[skm, other].map((actor) => transitionKanbanTask({ listId: card.id, action: "accept" }, actor))
			)
		);
		expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
		const events = await db.select().from(schema.taskEvents).where(eq(schema.taskEvents.listId, card.id));
		expect(events).toHaveLength(1);
	});

	it("only one concurrent save can consume a KKS revision", async () => {
		const { snapshot, group, item } = await installation();
		const input = { snapshotId: snapshot.id, groupId: group.id, kksItemId: item.id, baseRevision: 1 };
		const outcomes = await contend("installation_kks_items", () =>
			Promise.allSettled([
				saveInstallationKksState({ ...input, isDone: true }, skm),
				saveInstallationKksState({ ...input, isDone: false }, other),
			])
		);
		expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
		expect((await db.select().from(schema.installationKksItems))[0].revision).toBe(2);
	});

	it("refreshes pending conflicts and rejects an approval from a stale screen", async () => {
		const { snapshot, group, item } = await installation();
		await submitInstallationOfflineChanges(
			{
				userId: skm.id,
				snapshotId: snapshot.id,
				changes: [
					{
						clientMutationId: randomUUID(),
						groupId: group.id,
						kksItemId: item.id,
						baseDone: false,
						desiredDone: true,
					},
				],
			},
			skm
		);
		const [pending] = await db.select().from(schema.installationPendingChanges);
		await saveInstallationKksState(
			{ snapshotId: snapshot.id, groupId: group.id, kksItemId: item.id, baseRevision: 1, isDone: true },
			other
		);
		const board = await getActiveInstallationBoardData();
		expect(board.processingGroups[0].changes[0]).toMatchObject({
			hasConflict: true,
			serverDone: true,
			serverRevision: 2,
		});
		await expect(
			applyInstallationPendingGroup(
				{
					groupId: group.id,
					changes: [{ pendingChangeId: pending.id, baseRevision: 1, resolvedDone: false }],
				},
				master
			)
		).rejects.toThrow(/изменились/);
		expect((await db.select().from(schema.installationKksItems))[0].isDone).toBe(true);
		await applyInstallationPendingGroup(
			{ groupId: group.id, changes: [{ pendingChangeId: pending.id, baseRevision: 2, resolvedDone: false }] },
			master
		);
		expect((await db.select().from(schema.installationKksItems))[0].isDone).toBe(false);
	});

	it("deduplicates a retried offline submission", async () => {
		const { snapshot, group, item } = await installation();
		const input = {
			userId: skm.id,
			snapshotId: snapshot.id,
			changes: [
				{
					clientMutationId: randomUUID(),
					groupId: group.id,
					kksItemId: item.id,
					baseDone: false,
					desiredDone: true,
				},
			],
		};
		await submitInstallationOfflineChanges(input, skm);
		await submitInstallationOfflineChanges(input, skm);
		expect(await db.select().from(schema.installationPendingChanges)).toHaveLength(1);
	});

	it("refuses to attribute an old user's queued change to a new session", async () => {
		const { snapshot, group, item } = await installation();
		await expect(
			submitInstallationOfflineChanges(
				{
					userId: skm.id,
					snapshotId: snapshot.id,
					changes: [
						{
							clientMutationId: randomUUID(),
							groupId: group.id,
							kksItemId: item.id,
							baseDone: false,
							desiredDone: true,
						},
					],
				},
				other
			)
		).rejects.toThrow(/Аккаунт изменился/);
		expect(await db.select().from(schema.installationPendingChanges)).toHaveLength(0);
	});

	it("applies consistent decisions for duplicate pending items once", async () => {
		const { snapshot, group, item } = await installation();
		for (const actor of [skm, other])
			await submitInstallationOfflineChanges(
				{
					userId: actor.id,
					snapshotId: snapshot.id,
					changes: [
						{
							clientMutationId: randomUUID(),
							groupId: group.id,
							kksItemId: item.id,
							baseDone: false,
							desiredDone: true,
						},
					],
				},
				actor
			);
		const pending = await db.select().from(schema.installationPendingChanges);
		await applyInstallationPendingGroup(
			{
				groupId: group.id,
				changes: pending.map((entry) => ({ pendingChangeId: entry.id, baseRevision: 1, resolvedDone: true })),
			},
			master
		);
		expect((await db.select().from(schema.installationKksItems))[0]).toMatchObject({
			isDone: true,
			revision: 2,
		});
		expect(
			(await db.select().from(schema.installationPendingChanges)).every((entry) => entry.status === "applied")
		).toBe(true);
	});

	it("keeps independent Kanban lists available for remarks", async () => {
		const card = await list();
		const data = await getRemarksData();
		expect(data.targets.some((target) => target.type === "priority_list" && target.id === card.id)).toBe(
			true
		);
	});

	function workbook(rows: string[][], sheet = "Общ") {
		const book = Xlsx.utils.book_new();
		Xlsx.utils.book_append_sheet(book, Xlsx.utils.aoa_to_sheet(rows), sheet);
		const form = new FormData();
		form.set(
			"file",
			new File([Xlsx.write(book, { type: "buffer", bookType: "xlsx", compression: true })], "test.xlsx", {
				type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			})
		);
		return form;
	}
	function mapRows(count: number) {
		const header = Array.from({ length: 32 }, (_, i) => `column-${i}`);
		header[20] = "Ш_1";
		return [
			header,
			...Array.from({ length: count }, (_, i) => {
				const row = Array.from({ length: 32 }, () => "");
				row[0] = `cable-${i}`;
				row[7] = "A101";
				row[10] = "B202";
				row[11] = "10";
				row[12] = "4";
				row[13] = "40";
				row[14] = "3,6";
				row[15] = "ГЗ";
				row[16] = "ЧЗ";
				row[20] = "есть";
				return row;
			}),
		];
	}
	it("resets canonical progress even without a per-snapshot progress row", async () => {
		await importWorkbookFromFormData(workbook(mapRows(1)), master);
		const [cable] = await db.select().from(schema.cables);
		await db.update(schema.cables).set({ progress: 80 }).where(eq(schema.cables.id, cable.id));
		const [group] = await db.select().from(schema.graphGroups);
		const [room] = await db
			.select()
			.from(schema.graphGroupRooms)
			.where(eq(schema.graphGroupRooms.roomRole, "primary"));
		const [row] = await db.select().from(schema.importedCableRows);
		await saveCableProgressChanges(
			{ groupId: group.id, cables: [{ roomId: room.id, cableId: row.id, progress: 0 }] },
			master
		);
		expect((await db.select().from(schema.cables))[0].progress).toBe(0);
		expect((await db.select().from(schema.cableChangeAuditLogs))[0]).toMatchObject({
			oldProgress: 80,
			newProgress: 0,
		});
	});

	it("imports and backfills 26000 unique cables without exceeding parameter limits", async () => {
		await importWorkbookFromFormData(workbook(mapRows(26_000)), master);
		const [count] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.cables);
		expect(count.count).toBe(26_000);
		await db.update(schema.importedCableRows).set({ cableId: null });
		await db.delete(schema.cables);
		expect(await ensureCanonicalCableBase()).toBe(26_000);
	}, 120_000);

	it("imports explicit progress using bounded batches rather than an UPDATE per cable", async () => {
		await db.insert(schema.cables).values(
			Array.from({ length: 1000 }, (_, i) => ({
				externalKey: `journal:J|number:${i}`,
				cableLabel: `c-${i}`,
				cableMarking: `c-${i}`,
				cableJournal: "J",
				cableNumber: String(i),
			}))
		);
		const form = workbook(
			[
				["Кабель", "Журнал", "Номер", "Прогресс"],
				...Array.from({ length: 1000 }, (_, i) => [`c-${i}`, "J", String(i), "80"]),
			],
			"Task"
		);
		statements = 0;
		await importCableTaskListFromFormData(form, master);
		expect(statements).toBeLessThan(40);
		const [count] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(schema.cables)
			.where(eq(schema.cables.progress, 80));
		expect(count.count).toBe(1000);
	});
});
