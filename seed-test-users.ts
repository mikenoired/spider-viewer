#!/usr/bin/env bun

import { sql } from "drizzle-orm";
import { createLogger } from "./src/lib/logger";
import { TEST_USERS_PASSWORD, type UserRole } from "./src/lib/auth/shared";
import { hashPassword } from "./src/lib/auth/password";
import { closeDbConnection, getDb } from "./src/lib/db";
import { users } from "./src/lib/db/schema";

const logger = createLogger({ script: "seed-test-users" });

const usersPerRole = 10;

const roleConfigs: Array<{ role: UserRole; prefix: string }> = [
	{ role: "user", prefix: "user" },
	{ role: "admin", prefix: "admin" },
	{ role: "super-admin", prefix: "superadmin" },
];

async function seedTestUsers() {
	const db = getDb();
	const now = new Date();
	const records = [];

	for (const { role, prefix } of roleConfigs) {
		for (let index = 1; index <= usersPerRole; index += 1) {
			const login = `${prefix}${String(index).padStart(2, "0")}`;

			records.push({
				login,
				role,
				passwordHash: await hashPassword(TEST_USERS_PASSWORD),
				createdAt: now,
				updatedAt: now,
			});
		}
	}

	await db
		.insert(users)
		.values(records)
		.onConflictDoUpdate({
			target: users.login,
			set: {
				passwordHash: sql`excluded.password_hash`,
				role: sql`excluded.role`,
				updatedAt: now,
			},
		});

	logger.info({ count: records.length }, "Created or updated test users");
	logger.info(
		{ password: TEST_USERS_PASSWORD },
		"Password for all seeded users",
	);
	logger.info(
		{ examples: ["user01", "admin01", "superadmin01"] },
		"Seeded user examples",
	);
}

try {
	await seedTestUsers();
} finally {
	await closeDbConnection();
}
