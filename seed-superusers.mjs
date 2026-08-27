#!/usr/bin/env node

import { randomBytes, scrypt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";

import postgres from "postgres";

const scryptAsync = promisify(scrypt);
const SCRYPT_KEY_LENGTH = 64;

function loadLocalEnvFile(filePath = ".env") {
	if (!existsSync(filePath)) return;

	const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

	for (const line of lines) {
		const trimmedLine = line.trim();

		if (!trimmedLine || trimmedLine.startsWith("#")) continue;

		const match = /^(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/.exec(trimmedLine);

		if (!match) continue;

		const [, key, rawValue] = match;

		if (process.env[key] !== undefined) continue;

		process.env[key] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
	}
}

loadLocalEnvFile();

function normalizeLogin(login) {
	return login.trim().toLowerCase();
}

function assertString(value, fieldName) {
	if (typeof value !== "string") {
		throw new Error(`${fieldName} must be a string.`);
	}

	return value;
}

function validateLogin(login) {
	const normalizedLogin = normalizeLogin(assertString(login, "login"));

	if (normalizedLogin.length < 3) {
		throw new Error("Superuser login must contain at least 3 characters.");
	}

	if (normalizedLogin.length > 32) {
		throw new Error("Superuser login must not be longer than 32 characters.");
	}

	return normalizedLogin;
}

function validatePassword(password) {
	const value = assertString(password, "password");

	if (value.length < 8) {
		throw new Error("Superuser password must contain at least 8 characters.");
	}

	if (value.length > 128) {
		throw new Error("Superuser password must not be longer than 128 characters.");
	}

	return value;
}

function getConfiguredSuperusers() {
	const rawValue = process.env.AUTH_SUPERUSERS_JSON;

	if (!rawValue) {
		throw new Error("AUTH_SUPERUSERS_JSON is not configured.");
	}

	const parsedValue = JSON.parse(rawValue);

	if (!Array.isArray(parsedValue) || parsedValue.length !== 3) {
		throw new Error("AUTH_SUPERUSERS_JSON must contain exactly 3 superusers.");
	}

	const configuredSuperusers = parsedValue.map((user) => ({
		login: validateLogin(user?.login),
		password: validatePassword(user?.password),
	}));

	const uniqueLogins = new Set();

	for (const user of configuredSuperusers) {
		if (uniqueLogins.has(user.login)) {
			throw new Error(`Duplicate superuser login: ${user.login}`);
		}

		uniqueLogins.add(user.login);
	}

	return configuredSuperusers;
}

function getDatabaseUrl() {
	const databaseUrl = process.env.DATABASE_URL;

	if (!databaseUrl) {
		throw new Error("DATABASE_URL is not configured.");
	}

	return databaseUrl;
}

async function hashPassword(password) {
	const salt = randomBytes(16).toString("hex");
	const derivedKey = await scryptAsync(password, salt, SCRYPT_KEY_LENGTH);

	return `${salt}:${derivedKey.toString("hex")}`;
}

async function seedSuperusers() {
	const configuredSuperusers = getConfiguredSuperusers();
	const sql = postgres(getDatabaseUrl(), {
		prepare: false,
	});

	try {
		const now = new Date();
		const records = await Promise.all(
			configuredSuperusers.map(async ({ login, password }) => ({
				login,
				passwordHash: await hashPassword(password),
			}))
		);

		await sql.begin(async (transaction) => {
			for (const record of records) {
				await transaction`
					insert into users (
						login,
						password_hash,
						role,
						status,
						reviewed_by_user_id,
						reviewed_at,
						created_at,
						updated_at
					)
					values (
						${record.login},
						${record.passwordHash},
						'super-admin',
						'active',
						null,
						${now},
						${now},
						${now}
					)
					on conflict (login) do update set
						password_hash = excluded.password_hash,
						role = excluded.role,
						status = excluded.status,
						reviewed_by_user_id = null,
						reviewed_at = excluded.reviewed_at,
						updated_at = excluded.updated_at
				`;
			}
		});

		process.stdout.write(
			JSON.stringify({
				level: "info",
				script: "seed-superusers",
				count: configuredSuperusers.length,
				logins: configuredSuperusers.map(({ login }) => login),
				message: "Configured superusers created or updated",
			}) + "\n"
		);
	} finally {
		await sql.end();
	}
}

await seedSuperusers();
