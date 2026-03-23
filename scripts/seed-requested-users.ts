#!/usr/bin/env bun

import { sql } from "drizzle-orm";
import { createLogger } from "../src/lib/logger";
import type { UserRole } from "../src/lib/auth/shared";
import { hashPassword } from "../src/lib/auth/password";
import { closeDbConnection, getDb } from "../src/lib/db";
import { users } from "../src/lib/db/schema";

const logger = createLogger({ script: "seed-requested-users" });

const requestedUsers: Array<{
	login: string;
	password: string;
	role: UserRole;
}> = [
	{ login: "breker", password: "bre01", role: "super-admin" },
	{ login: "koreckiy", password: "kor02", role: "admin" },
	{ login: "kovatev", password: "kov03", role: "admin" },
	{ login: "fedorcov", password: "fed04", role: "admin" },
	{ login: "denisenko", password: "den05", role: "admin" },
	{ login: "potapovich", password: "pot06", role: "admin" },
	{ login: "kozurev", password: "koz07", role: "admin" },
	{ login: "akulinichev", password: "aku08", role: "admin" },
	{ login: "muratov", password: "mur09", role: "admin" },
	{ login: "babushev", password: "bab10", role: "admin" },
	{ login: "nstai", password: "nst11", role: "admin" },
	{ login: "bondaruk", password: "bon12", role: "admin" },
	{ login: "breduhin", password: "bre13", role: "admin" },
	{ login: "kostin", password: "kos14", role: "admin" },
	{ login: "ulybin", password: "uly15", role: "admin" },
	{ login: "boev", password: "boe16", role: "admin" },
	{ login: "sapronov", password: "sap17", role: "admin" },
	{ login: "andrianov", password: "and18", role: "admin" },
	{ login: "tai2", password: "tai19", role: "admin" },
	{ login: "mihailov", password: "mih20", role: "admin" },
	{ login: "kasatkin", password: "kas21", role: "admin" },
	{ login: "tarasov", password: "tar22", role: "admin" },
	{ login: "naladka", password: "nal23", role: "admin" },
	{ login: "eskm", password: "esk24", role: "user" },
	{ login: "gnomiknapony", password: "kiko1", role: "super-admin" },
	{ login: "vetkal", password: "vetk1", role: "super-admin" },
];

function validateRequestedUsers() {
	const logins = new Set<string>();
	const passwords = new Set<string>();

	for (const user of requestedUsers) {
		if (user.password.length !== 5) {
			throw new Error(
				`Password for ${user.login} must be exactly 5 characters long.`,
			);
		}

		if (logins.has(user.login)) {
			throw new Error(`Duplicate login: ${user.login}`);
		}

		if (passwords.has(user.password)) {
			throw new Error(`Duplicate password: ${user.password}`);
		}

		logins.add(user.login);
		passwords.add(user.password);
	}
}

async function seedRequestedUsers() {
	validateRequestedUsers();

	const db = getDb();
	const now = new Date();
	const records = await Promise.all(
		requestedUsers.map(async ({ login, password, role }) => ({
			login,
			role,
			passwordHash: await hashPassword(password),
			createdAt: now,
			updatedAt: now,
		})),
	);

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

	logger.info(
		{ count: requestedUsers.length },
		"Created or updated requested users",
	);
	for (const { login, password, role } of requestedUsers) {
		logger.info({ login, password, role }, "Requested user credential");
	}
}

try {
	await seedRequestedUsers();
} finally {
	await closeDbConnection();
}
