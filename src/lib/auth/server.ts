import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import type { CookieSerializeOptions } from "cookie-es";
import { asc, desc, eq } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";

import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";

import { hashPassword, verifyPassword } from "./password";
import type { AuthSession, LoginInput, ManagedUsersView, ManagedUserView, RegisterInput } from "./shared";
import { AUTH_COOKIE_NAME, loginSchema, normalizeLogin, registerSchema } from "./shared";

const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

declare global {
	var __spiderViewerLegacyAuthUsersPromise__: Promise<void> | undefined;
}

function getJwtSecret() {
	const secret = process.env.JWT_SECRET;

	if (!secret) throw new Error("JWT_SECRET is not configured.");

	return new TextEncoder().encode(secret);
}

function shouldUseSecureAuthCookie() {
	const configuredValue = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();

	if (configuredValue === "true") return true;
	if (configuredValue === "false") return false;

	return process.env.NODE_ENV === "production";
}

function getAuthCookieOptions(): CookieSerializeOptions {
	return {
		httpOnly: true,
		path: "/",
		sameSite: "lax",
		secure: shouldUseSecureAuthCookie(),
		maxAge: AUTH_COOKIE_MAX_AGE,
	};
}

async function createAuthToken(session: AuthSession) {
	return new SignJWT({
		login: session.login,
		role: session.role,
	})
		.setProtectedHeader({ alg: "HS256" })
		.setSubject(session.id)
		.setIssuedAt()
		.setExpirationTime("7d")
		.sign(getJwtSecret());
}

async function verifyAuthToken(token: string) {
	const { payload } = await jwtVerify(token, getJwtSecret());
	return payload;
}

function toManagedUserView(user: {
	id: string;
	login: string;
	role: ManagedUserView["role"];
	status: ManagedUserView["status"];
	createdAt: Date;
	reviewedAt: Date | null;
}) {
	return {
		id: user.id,
		login: user.login,
		role: user.role,
		status: user.status,
		createdAt: user.createdAt.toISOString(),
		reviewedAt: user.reviewedAt?.toISOString() ?? null,
	} satisfies ManagedUserView;
}

async function reconcileLegacyAdminUsers() {
	const db = getDb();
	const now = new Date();

	await db.update(users).set({ role: "user", updatedAt: now }).where(eq(users.role, "admin"));
}

async function ensureLegacyAuthUsersReconciled() {
	if (!globalThis.__spiderViewerLegacyAuthUsersPromise__) {
		globalThis.__spiderViewerLegacyAuthUsersPromise__ = reconcileLegacyAdminUsers().catch((error) => {
			globalThis.__spiderViewerLegacyAuthUsersPromise__ = undefined;
			throw error;
		});
	}

	await globalThis.__spiderViewerLegacyAuthUsersPromise__;
}

export async function getCurrentSession() {
	await ensureLegacyAuthUsersReconciled();

	const token = getCookie(AUTH_COOKIE_NAME);

	if (!token) return null;

	try {
		const payload = await verifyAuthToken(token);

		if (!payload.sub) {
			deleteCookie(AUTH_COOKIE_NAME, getAuthCookieOptions());
			return null;
		}

		const db = getDb();
		const [user] = await db
			.select({
				id: users.id,
				login: users.login,
				role: users.role,
				status: users.status,
			})
			.from(users)
			.where(eq(users.id, payload.sub))
			.limit(1);

		if (!user || user.status !== "active") {
			deleteCookie(AUTH_COOKIE_NAME, getAuthCookieOptions());
			return null;
		}

		return {
			id: user.id,
			login: user.login,
			role: user.role,
		} satisfies AuthSession;
	} catch {
		deleteCookie(AUTH_COOKIE_NAME, getAuthCookieOptions());
		return null;
	}
}

export async function loginWithCredentials(input: LoginInput) {
	await ensureLegacyAuthUsersReconciled();

	const { login, password } = loginSchema.parse(input);
	const db = getDb();
	const [user] = await db
		.select({
			id: users.id,
			login: users.login,
			passwordHash: users.passwordHash,
			role: users.role,
			status: users.status,
		})
		.from(users)
		.where(eq(users.login, normalizeLogin(login)))
		.limit(1);

	if (!user) throw new Error("Неверный логин или пароль.");

	const passwordMatches = await verifyPassword(password, user.passwordHash);

	if (!passwordMatches) throw new Error("Неверный логин или пароль.");
	if (user.status === "pending") throw new Error("Регистрация ещё не подтверждена суперпользователем.");
	if (user.status === "rejected")
		throw new Error("Заявка на регистрацию была отклонена. Подайте её повторно.");

	const session = {
		id: user.id,
		login: user.login,
		role: user.role,
	} satisfies AuthSession;

	const token = await createAuthToken(session);

	setCookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions());

	return session;
}

export async function registerWithCredentials(input: RegisterInput) {
	await ensureLegacyAuthUsersReconciled();

	const { login, password } = registerSchema.parse(input);
	const normalizedLogin = normalizeLogin(login);
	const db = getDb();
	const now = new Date();
	const [existingUser] = await db
		.select({
			id: users.id,
			status: users.status,
		})
		.from(users)
		.where(eq(users.login, normalizedLogin))
		.limit(1);

	if (existingUser?.status === "active") {
		throw new Error("Пользователь с таким логином уже существует.");
	}

	if (existingUser?.status === "pending") {
		throw new Error("Заявка с таким логином уже отправлена и ожидает подтверждения.");
	}

	const passwordHash = await hashPassword(password);

	if (existingUser?.status === "rejected") {
		await db
			.update(users)
			.set({
				passwordHash,
				role: "user",
				status: "pending",
				reviewedByUserId: null,
				reviewedAt: null,
				updatedAt: now,
			})
			.where(eq(users.id, existingUser.id));
	} else {
		await db.insert(users).values({
			login: normalizedLogin,
			passwordHash,
			role: "user",
			status: "pending",
			createdAt: now,
			updatedAt: now,
		});
	}

	return {
		status: "pending" as const,
	};
}

export async function getManagedUsers() {
	await ensureLegacyAuthUsersReconciled();

	const db = getDb();
	const rows = await db
		.select({
			id: users.id,
			login: users.login,
			role: users.role,
			status: users.status,
			createdAt: users.createdAt,
			reviewedAt: users.reviewedAt,
		})
		.from(users)
		.orderBy(desc(users.createdAt), asc(users.login));

	const items = rows.map(toManagedUserView);
	const active = items
		.filter((item) => item.status === "active")
		.sort((left, right) => {
			if (left.role !== right.role) {
				return left.role === "super-admin" ? -1 : 1;
			}

			return left.login.localeCompare(right.login, "ru", {
				sensitivity: "base",
			});
		});

	return {
		pending: items.filter((item) => item.status === "pending"),
		active,
		rejected: items.filter((item) => item.status === "rejected"),
	} satisfies ManagedUsersView;
}

export async function approvePendingUser(userId: string, reviewer: AuthSession) {
	await ensureLegacyAuthUsersReconciled();

	const db = getDb();
	const now = new Date();
	const [user] = await db
		.select({
			id: users.id,
			role: users.role,
			status: users.status,
		})
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);

	if (!user) throw new Error("Пользователь не найден.");
	if (user.role === "super-admin") throw new Error("Суперпользователь не подтверждается через эту форму.");
	if (user.status === "active") throw new Error("Пользователь уже подтверждён.");
	if (user.status === "rejected") throw new Error("Отклонённую заявку нужно подать заново.");

	await db
		.update(users)
		.set({
			role: "user",
			status: "active",
			reviewedByUserId: reviewer.id,
			reviewedAt: now,
			updatedAt: now,
		})
		.where(eq(users.id, user.id));

	return { success: true };
}

export async function rejectPendingUser(userId: string, reviewer: AuthSession) {
	await ensureLegacyAuthUsersReconciled();

	const db = getDb();
	const now = new Date();
	const [user] = await db
		.select({
			id: users.id,
			role: users.role,
			status: users.status,
		})
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);

	if (!user) throw new Error("Пользователь не найден.");
	if (user.role === "super-admin")
		throw new Error("Суперпользователь не может быть отклонён через эту форму.");
	if (user.status === "active")
		throw new Error("Активного пользователя нельзя отклонить через список заявок.");
	if (user.status === "rejected") throw new Error("Заявка уже отклонена.");

	await db
		.update(users)
		.set({
			role: "user",
			status: "rejected",
			reviewedByUserId: reviewer.id,
			reviewedAt: now,
			updatedAt: now,
		})
		.where(eq(users.id, user.id));

	return { success: true };
}

export async function logout() {
	deleteCookie(AUTH_COOKIE_NAME, getAuthCookieOptions());
}
