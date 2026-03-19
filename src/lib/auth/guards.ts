import { getCurrentSession } from "./server";
import type { AuthSession, UserRole } from "./shared";

export async function requireSession() {
	const session = await getCurrentSession();

	if (!session) throw new Error("Требуется авторизация.");

	return session;
}

export function assertRole(session: AuthSession, roles: UserRole[]) {
	if (!roles.includes(session.role)) {
		throw new Error("Недостаточно прав для выполнения действия.");
	}

	return session;
}

export async function requireRole(roles: UserRole[]) {
	const session = await requireSession();
	return assertRole(session, roles);
}
