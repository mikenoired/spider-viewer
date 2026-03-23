import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server"
import type { CookieSerializeOptions } from "cookie-es"
import { eq } from "drizzle-orm"
import { jwtVerify, SignJWT } from "jose"
import { getDb } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { verifyPassword } from "./password"
import type { AuthSession, LoginInput } from "./shared"
import { AUTH_COOKIE_NAME, loginSchema } from "./shared"

const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7

function getJwtSecret() {
	const secret = process.env.JWT_SECRET

	if (!secret) throw new Error("JWT_SECRET is not configured.")

	return new TextEncoder().encode(secret)
}

function shouldUseSecureAuthCookie() {
	const configuredValue = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase()

	if (configuredValue === "true") return true
	if (configuredValue === "false") return false

	return process.env.NODE_ENV === "production"
}

function getAuthCookieOptions(): CookieSerializeOptions {
	return {
		httpOnly: true,
		path: "/",
		sameSite: "lax",
		secure: shouldUseSecureAuthCookie(),
		maxAge: AUTH_COOKIE_MAX_AGE,
	}
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
		.sign(getJwtSecret())
}

async function verifyAuthToken(token: string) {
	const { payload } = await jwtVerify(token, getJwtSecret())
	return payload
}

function normalizeLogin(login: string) {
	return login.trim().toLowerCase()
}

export async function getCurrentSession() {
	const token = getCookie(AUTH_COOKIE_NAME)

	if (!token) return null

	try {
		const payload = await verifyAuthToken(token)

		if (!payload.sub) {
			deleteCookie(AUTH_COOKIE_NAME, getAuthCookieOptions())
			return null
		}

		const db = getDb()
		const [user] = await db
			.select({
				id: users.id,
				login: users.login,
				role: users.role,
			})
			.from(users)
			.where(eq(users.id, payload.sub))
			.limit(1)

		if (!user) {
			deleteCookie(AUTH_COOKIE_NAME, getAuthCookieOptions())
			return null
		}

		return {
			id: user.id,
			login: user.login,
			role: user.role,
		} satisfies AuthSession
	} catch {
		deleteCookie(AUTH_COOKIE_NAME, getAuthCookieOptions())
		return null
	}
}

export async function loginWithCredentials(input: LoginInput) {
	const { login, password } = loginSchema.parse(input)
	const db = getDb()
	const [user] = await db
		.select({
			id: users.id,
			login: users.login,
			passwordHash: users.passwordHash,
			role: users.role,
		})
		.from(users)
		.where(eq(users.login, normalizeLogin(login)))
		.limit(1)

	if (!user) throw new Error("Неверный логин или пароль.")

	const passwordMatches = await verifyPassword(password, user.passwordHash)

	if (!passwordMatches) throw new Error("Неверный логин или пароль.")

	const session = {
		id: user.id,
		login: user.login,
		role: user.role,
	} satisfies AuthSession

	const token = await createAuthToken(session)

	setCookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions())

	return session
}

export async function logout() {
	deleteCookie(AUTH_COOKIE_NAME, getAuthCookieOptions())
}
