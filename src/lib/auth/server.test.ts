import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { SignJWT } from "jose";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { users } from "@/lib/db/schema";

import { hashPassword, verifyPassword } from "./password";
import type { AuthSession } from "./shared";
import { AUTH_COOKIE_NAME } from "./shared";

const cookies = vi.hoisted(() => new Map<string, string>());
vi.mock("@tanstack/react-start/server", () => ({
	getCookie: (name: string) => cookies.get(name),
	setCookie: (name: string, value: string) => cookies.set(name, value),
	deleteCookie: (name: string) => cookies.delete(name),
}));
let db: ReturnType<typeof drizzle>;
vi.mock("@/lib/db", () => ({ getDb: () => db }));

import { requireRole } from "./guards";
import {
	changeOwnPassword,
	createManagedUser,
	deleteManagedUser,
	getCurrentSession,
	getManagedUsers,
	loginWithCredentials,
	updateManagedUserDepartment,
	updateManagedUserLogin,
	updateManagedUserPassword,
	updateManagedUserRole,
	approvePendingUser,
} from "./server";

// Use an explicitly supplied disposable PostgreSQL database, never the app DATABASE_URL.
const testUrl = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!testUrl)("account management with PostgreSQL", () => {
	let client: ReturnType<typeof postgres>;
	const schemaName = `auth_test_${randomUUID().replaceAll("-", "")}`;
	const master: AuthSession = { id: randomUUID(), login: "master", role: "super-admin", department: "tai" };
	const worker: AuthSession = { id: randomUUID(), login: "worker", role: "user", department: "skm" };
	const oldPassword = "OldPassword123";
	const newPassword = "NewPassword456";
	let initialHash: string;
	const passwordInput = { userId: worker.id, password: newPassword, confirmPassword: newPassword };

	beforeAll(async () => {
		vi.stubEnv("JWT_SECRET", "isolated-auth-integration-test-secret");
		client = postgres(testUrl!, { max: 1, prepare: false });
		await client.unsafe(`create schema ${schemaName}`);
		await client.unsafe(`set search_path to ${schemaName}`);
		await client.unsafe(`
   create type user_role as enum ('user', 'admin', 'super-admin');
   create type user_status as enum ('pending', 'active', 'rejected');
   create type user_department as enum ('tai', 'skm', 'commissioning', 'curator');
   create table users (
    id uuid primary key, login text not null unique, password_hash text not null,
    role user_role not null default 'user', department user_department not null default 'tai',
    status user_status not null default 'active', reviewed_by_user_id uuid references users(id),
    reviewed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
   );
   create table task_comments (id uuid primary key, created_by_user_id uuid not null references users(id) on delete restrict, content text not null);
  `);
		const migration = readFileSync(resolve("drizzle/0003_dark_joshua_kane.sql"), "utf8");
		for (const statement of migration.split("--> statement-breakpoint")) await client.unsafe(statement);
		db = drizzle(client);
		initialHash = await hashPassword(oldPassword);
	});
	beforeEach(async () => {
		cookies.clear();
		await client.unsafe("truncate task_comments, users cascade");
		await db.insert(users).values([master, worker].map((user) => ({ ...user, passwordHash: initialHash })));
	});
	afterAll(async () => {
		if (client) {
			await client.unsafe(`drop schema if exists ${schemaName} cascade`);
			await client.end();
		}
		vi.unstubAllEnvs();
	});
	async function signIn(login = worker.login, password = oldPassword) {
		await loginWithCredentials({ login, password });
		return cookies.get(AUTH_COOKIE_NAME)!;
	}
	async function row(id = worker.id) {
		return (await db.select().from(users).where(eq(users.id, id)))[0];
	}

	it("rejects ordinary users and admins at server guards and account mutations", async () => {
		await signIn();
		await expect(requireRole(["super-admin"])).rejects.toThrow(/Недостаточно прав/);
		for (const role of ["user", "admin"] as const) {
			const actor = { ...worker, role };
			await expect(updateManagedUserLogin({ userId: master.id, login: "hacked" }, actor)).rejects.toThrow(
				/Недостаточно прав/
			);
			await expect(updateManagedUserPassword(passwordInput, actor)).rejects.toThrow(/Недостаточно прав/);
			await expect(deleteManagedUser(master.id, actor)).rejects.toThrow(/Недостаточно прав/);
		}
		expect((await row()).sessionVersion).toBe(0);
	});
	it("normalizes renamed logins, rejects duplicates, revokes tokens and allows new login", async () => {
		const token = await signIn();
		await expect(updateManagedUserLogin({ userId: worker.id, login: " MASTER " }, master)).rejects.toThrow(
			/уже существует/
		);
		await updateManagedUserLogin({ userId: worker.id, login: " Renamed " }, master);
		cookies.set(AUTH_COOKIE_NAME, token);
		expect(await getCurrentSession()).toBeNull();
		await expect(signIn("worker")).rejects.toThrow(/Неверный логин/);
		await signIn("RENAMED");
		expect(await getCurrentSession()).toMatchObject({ id: worker.id, login: "renamed" });
	});
	it("does not revoke sessions when login is unchanged", async () => {
		await signIn();
		expect(await updateManagedUserLogin({ userId: worker.id, login: " WORKER " }, master)).toMatchObject({
			requiresLogin: false,
		});
		expect(await getCurrentSession()).toMatchObject({ id: worker.id });
	});
	it("resets passwords without the old password and rejects all old tokens", async () => {
		const token = await signIn();
		await updateManagedUserPassword(passwordInput, master);
		cookies.set(AUTH_COOKIE_NAME, token);
		expect(await getCurrentSession()).toBeNull();
		await expect(signIn()).rejects.toThrow(/Неверный логин/);
		expect(await verifyPassword(newPassword, (await row()).passwordHash)).toBe(true);
		await signIn("worker", newPassword);
		expect(await getCurrentSession()).toMatchObject({ id: worker.id });
	});
	it("requires current password, validates confirmation and logs out after self change", async () => {
		const token = await signIn();
		await expect(
			changeOwnPassword({ currentPassword: "WrongPassword", ...passwordInput }, worker)
		).rejects.toThrow(/Текущий пароль неверен/);
		await expect(
			changeOwnPassword(
				{ currentPassword: oldPassword, password: newPassword, confirmPassword: "Mismatch" },
				worker
			)
		).rejects.toThrow(/не совпадают/);
		expect((await row()).sessionVersion).toBe(0);
		expect(await changeOwnPassword({ currentPassword: oldPassword, ...passwordInput }, worker)).toMatchObject(
			{ requiresLogin: true }
		);
		expect(cookies.has(AUTH_COOKIE_NAME)).toBe(false);
		cookies.set(AUTH_COOKIE_NAME, token);
		expect(await getCurrentSession()).toBeNull();
		await signIn("worker", newPassword);
	});
	it("supports editing super-admin credentials and changing own super-admin password", async () => {
		await signIn("master");
		expect(await updateManagedUserLogin({ userId: master.id, login: "new-master" }, master)).toMatchObject({
			requiresLogin: true,
		});
		expect(cookies.has(AUTH_COOKIE_NAME)).toBe(false);
		await signIn("new-master");
		await updateManagedUserPassword({ ...passwordInput, userId: master.id }, master);
		await signIn("new-master", newPassword);
		await changeOwnPassword(
			{ currentPassword: newPassword, password: oldPassword, confirmPassword: oldPassword },
			master
		);
		await signIn("new-master", oldPassword);
	});
	it("prevents deletion of every super-admin including the current account", async () => {
		const otherMaster = { ...master, id: randomUUID(), login: "other-master" };
		await db.insert(users).values({ ...otherMaster, passwordHash: initialHash });
		for (const userId of [master.id, otherMaster.id])
			await expect(deleteManagedUser(userId, master)).rejects.toThrow(/Нельзя удалить суперпользователя/);
	});
	it("deletes accounts with history, reserves the login, blocks sessions and prevents reactivation", async () => {
		await client`insert into task_comments values (${randomUUID()}, ${worker.id}, 'preserved history')`;
		const token = await signIn();
		await deleteManagedUser(worker.id, master);
		expect((await row()).deletedAt).toBeInstanceOf(Date);
		expect((await client`select content from task_comments`)[0].content).toBe("preserved history");
		expect((await getManagedUsers()).active.map((user) => user.id)).not.toContain(worker.id);
		expect((await getManagedUsers()).rejected).toHaveLength(0);
		expect(await db.select().from(users).where(eq(users.status, "active"))).toHaveLength(1);
		cookies.set(AUTH_COOKIE_NAME, token);
		expect(await getCurrentSession()).toBeNull();
		await expect(signIn()).rejects.toThrow(/Неверный логин/);
		await expect(
			createManagedUser(
				{
					login: worker.login,
					password: newPassword,
					confirmPassword: newPassword,
					role: "user",
					department: "skm",
				},
				master
			)
		).rejects.toThrow(/Логин удалённого аккаунта занят/);
		await expect(updateManagedUserLogin({ userId: master.id, login: "WORKER" }, master)).rejects.toThrow(
			/уже существует/
		);
		await expect(updateManagedUserRole({ userId: worker.id, role: "super-admin" }, master)).rejects.toThrow(
			/не найден/
		);
		await expect(
			updateManagedUserDepartment({ userId: worker.id, department: "tai" }, master)
		).rejects.toThrow(/не найден/);
		await expect(approvePendingUser(worker.id, master)).rejects.toThrow(/не найден/);
		await expect(updateManagedUserPassword(passwordInput, master)).rejects.toThrow(/не найден/);
	});
	it("deletes pending, rejected and legacy admin accounts", async () => {
		for (const status of ["pending", "rejected", "active"] as const) {
			const userId = randomUUID();
			await db
				.insert(users)
				.values({ id: userId, login: `account-${status}`, role: "admin", status, passwordHash: initialHash });
			await deleteManagedUser(userId, master);
			expect((await row(userId)).deletedAt).toBeInstanceOf(Date);
		}
	});
	it("accepts legacy tokens only until credentials are changed", async () => {
		const token = await new SignJWT({ login: worker.login, role: worker.role })
			.setProtectedHeader({ alg: "HS256" })
			.setSubject(worker.id)
			.setExpirationTime("1h")
			.sign(new TextEncoder().encode(process.env.JWT_SECRET));
		cookies.set(AUTH_COOKIE_NAME, token);
		expect(await getCurrentSession()).toMatchObject({ id: worker.id });
		await updateManagedUserPassword(passwordInput, master);
		cookies.set(AUTH_COOKIE_NAME, token);
		expect(await getCurrentSession()).toBeNull();
	});
});
