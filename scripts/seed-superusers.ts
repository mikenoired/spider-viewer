#!/usr/bin/env bun

import { hashPassword } from "../src/lib/auth/password";
import { bootstrapSuperusersSchema, type BootstrapSuperuser, normalizeLogin } from "../src/lib/auth/shared";
import { closeDbConnection, getDb } from "../src/lib/db";
import { users } from "../src/lib/db/schema";
import { createLogger } from "../src/lib/logger";

const logger = createLogger({ script: "seed-superusers" });

function getConfiguredSuperusers() {
	const rawValue = process.env.AUTH_SUPERUSERS_JSON;

	if (!rawValue) {
		throw new Error("AUTH_SUPERUSERS_JSON is not configured.");
	}

	const parsedValue = JSON.parse(rawValue);

	return bootstrapSuperusersSchema.parse(parsedValue).map((user) => ({
		...user,
		login: normalizeLogin(user.login),
	}));
}

function validateConfiguredSuperusers(configuredSuperusers: BootstrapSuperuser[]) {
	const uniqueLogins = new Set<string>();

	for (const user of configuredSuperusers) {
		if (uniqueLogins.has(user.login)) {
			throw new Error(`Duplicate superuser login: ${user.login}`);
		}

		uniqueLogins.add(user.login);
	}
}

async function seedSuperusers() {
	const configuredSuperusers = getConfiguredSuperusers();

	validateConfiguredSuperusers(configuredSuperusers);

	const db = getDb();
	const [existing] = await db.select({ id: users.id }).from(users).limit(1);
	if (existing) {
		logger.info("Existing accounts preserved; bootstrap skipped");
		return;
	}
	const now = new Date();
	const records = await Promise.all(
		configuredSuperusers.map(async ({ login, password }) => ({
			login,
			passwordHash: await hashPassword(password),
			role: "super-admin" as const,
			status: "active" as const,
			reviewedByUserId: null,
			reviewedAt: now,
			createdAt: now,
			updatedAt: now,
		}))
	);

	await db.insert(users).values(records).onConflictDoNothing({ target: users.login });

	logger.info(
		{
			count: configuredSuperusers.length,
			logins: configuredSuperusers.map(({ login }) => login),
		},
		"Initial configured superusers created"
	);
}

try {
	await seedSuperusers();
} finally {
	await closeDbConnection();
}
