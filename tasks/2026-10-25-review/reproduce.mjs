// Run with Bun from the repository root. Uses synthetic data and an in-memory DB double.
// This is an audit reproducer of current defects, not a passing regression suite.
import assert from "node:assert/strict";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { saveCableProgressChanges } from "../../src/lib/cable-map/history.server.ts";
import { transitionKanbanTask } from "../../src/lib/cable-map/task-workflow.server.ts";
import { cables } from "../../src/lib/db/schema.ts";
import { saveInstallationKksState } from "../../src/lib/installation/mutations.server.ts";

const session = { id: "u", login: "test", role: "user", department: "commissioning" };
function log(message) {
	process.stdout.write(`${message}\n`);
}
function selectResult(rows) {
	return {
		from() {
			return this;
		},
		innerJoin() {
			return this;
		},
		where() {
			return this;
		},
		limit() {
			return Promise.resolve(rows);
		},
		// oxlint-disable-next-line unicorn/no-thenable -- Emulate the awaited Drizzle query builder in this DB double.
		then(resolve, reject) {
			return Promise.resolve(rows).then(resolve, reject);
		},
	};
}
const previousDb = globalThis.__spiderViewerDb__;
try {
	const updates = [];
	let reads = 0;
	globalThis.__spiderViewerDb__ = {
		select() {
			return selectResult(
				reads++ === 0 ? [{ id: "l", fileName: "test", status: "adjustment", responsibleUserId: null }] : []
			);
		},
		update() {
			return {
				set(value) {
					updates.push(value);
					return this;
				},
				where() {
					return this;
				},
				returning() {
					return Promise.resolve([{ id: "l", status: updates.at(-1).status }]);
				},
			};
		},
		insert() {
			return {
				values() {
					return this;
				},
				returning() {
					return Promise.resolve([{ id: "e" }]);
				},
			};
		},
	};
	const moved = await transitionKanbanTask({ listId: "l", action: "move", status: "formed" }, session);
	assert.equal(moved.status, "formed");
	log("F-03 reproduced: commissioning can move adjustment -> formed.");

	const queryRows = [
		[{ id: "g", snapshotId: "s", groupKey: "dirty:none:z:1" }],
		[{ id: "r", roomName: "room" }],
		[
			{
				id: "row",
				cableId: "canonical",
				cableLabel: "c",
				fromRoom: "room",
				fromZone: "z",
				level: "1",
				graphSide: "dirty",
				graphSubzone: null,
			},
		],
		[],
	];
	reads = 0;
	globalThis.__spiderViewerDb__ = {
		select() {
			return selectResult(queryRows[reads++]);
		},
		transaction() {
			throw Error("Unexpected write: the buggy path skips persistence.");
		},
	};
	const reset = await saveCableProgressChanges(
		{ groupId: "g", cables: [{ roomId: "r", cableId: "row", progress: 0 }] },
		{ ...session, role: "super-admin" }
	);
	assert.equal(reset.changedCount, 0);
	log(
		"F-04 reproduced: reset to 0 is skipped when snapshot progress is absent; canonical progress is not queried."
	);

	let revision = 1;
	globalThis.__spiderViewerDb__ = {
		select(fields) {
			return selectResult("revision" in fields ? [{ id: "i", revision }] : [{ id: "s" }]);
		},
		update() {
			return {
				set() {
					return this;
				},
				where() {
					return this;
				},
				returning() {
					revision++;
					return Promise.resolve([{ id: "i", revision }]);
				},
			};
		},
	};
	const input = { snapshotId: "s", groupId: "g", kksItemId: "i", isDone: true, baseRevision: 1 };
	const saved = await Promise.all([
		saveInstallationKksState(input, session),
		saveInstallationKksState({ ...input, isDone: false }, session),
	]);
	assert.deepEqual(
		saved.map((item) => item.revision),
		[2, 3]
	);
	log("F-05 reproduced with DB double: both conflicting saves with baseRevision=1 succeed.");
} finally {
	globalThis.__spiderViewerDb__ = previousDb;
}

// Compile only: this client is never queried and connects to no service.
const client = postgres("postgres://unused:unused@127.0.0.1:1/unused");
try {
	const db = drizzle(client);
	const now = new Date();
	const rows = Array.from({ length: 26_000 }, (_, index) => ({
		externalKey: `c${index}`,
		cableLabel: "label",
		cableMarking: "mark",
		cableJournal: "j",
		cableNumber: String(index),
		fromRoom: "a",
		toRoom: "b",
		createdAt: now,
		updatedAt: now,
	}));
	const query = db.insert(cables).values(rows).toSQL();
	assert.equal(query.params.length, 234_000);
	assert.ok(query.params.length >= 65_534);
	log(
		`F-02 reproduced: ${rows.length} rows -> ${query.params.length} parameters; postgres driver rejects >=65534.`
	);
} finally {
	await client.end();
}
