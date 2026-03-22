import { z } from "zod";

export const PROJECT_NAME = "Spider Viewer";

export const userRoles = ["user", "admin", "super-admin"] as const;

export const userRoleSchema = z.enum(userRoles);

export type UserRole = z.infer<typeof userRoleSchema>;

export type AuthSession = {
	id: string;
	login: string;
	role: UserRole;
};

export const loginSchema = z.object({
	login: z
		.string()
		.trim()
		.min(3, "Логин должен содержать минимум 3 символа.")
		.max(32, "Логин не должен быть длиннее 32 символов."),
	password: z
		.string()
		.min(5, "Пароль должен содержать минимум 5 символов.")
		.max(128, "Пароль не должен быть длиннее 128 символов."),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const roleLabels: Record<UserRole, string> = {
	user: "Пользователь",
	admin: "Админ",
	"super-admin": "Супер-админ",
};

export function canEditProgress(role: UserRole) {
	return role === "admin" || role === "super-admin";
}

export function canUploadSnapshot(role: UserRole) {
	return role === "super-admin";
}

export function canViewAudit(role: UserRole) {
	return role === "super-admin";
}

export function canManageManualRooms(role: UserRole) {
	return role === "super-admin";
}

export const TEST_USERS_PASSWORD = "Password123!";
export const AUTH_COOKIE_NAME = "spider_viewer_session";
