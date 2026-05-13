import * as z from "zod";

export const PROJECT_NAME = "Spider Viewer";

export const userRoles = ["user", "admin", "super-admin"] as const;
export const userStatuses = ["pending", "active", "rejected"] as const;
export const assignableUserRoles = ["user", "super-admin"] as const;

export const userRoleSchema = z.enum(userRoles);
export const userStatusSchema = z.enum(userStatuses);
export const assignableUserRoleSchema = z.enum(assignableUserRoles);

export type UserRole = z.infer<typeof userRoleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
export type AssignableUserRole = z.infer<typeof assignableUserRoleSchema>;

export type AuthSession = {
	id: string;
	login: string;
	role: UserRole;
};

const loginValueSchema = z
	.string()
	.trim()
	.min(3, "Логин должен содержать минимум 3 символа.")
	.max(32, "Логин не должен быть длиннее 32 символов.");

const loginPasswordSchema = z
	.string()
	.min(5, "Пароль должен содержать минимум 5 символов.")
	.max(128, "Пароль не должен быть длиннее 128 символов.");

const registrationPasswordSchema = z
	.string()
	.min(8, "Пароль должен содержать минимум 8 символов.")
	.max(128, "Пароль не должен быть длиннее 128 символов.");

export function normalizeLogin(login: string) {
	return login.trim().toLowerCase();
}

export const loginSchema = z.object({
	login: loginValueSchema,
	password: loginPasswordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;

export const registerFieldsSchema = z.object({
	login: loginValueSchema,
	password: registrationPasswordSchema,
	confirmPassword: z.string().max(128, "Подтверждение пароля не должно быть длиннее 128 символов."),
});

export const registerSchema = registerFieldsSchema.refine(
	(value) => value.password === value.confirmPassword,
	{
		path: ["confirmPassword"],
		message: "Пароли не совпадают.",
	}
);

export type RegisterInput = z.infer<typeof registerSchema>;

export const userModerationSchema = z.object({
	userId: z.string().uuid("Некорректный идентификатор пользователя."),
});

export type UserModerationInput = z.infer<typeof userModerationSchema>;

export const createManagedUserFieldsSchema = z.object({
	login: loginValueSchema,
	password: registrationPasswordSchema,
	confirmPassword: z.string().max(128, "Подтверждение пароля не должно быть длиннее 128 символов."),
	role: assignableUserRoleSchema,
});

export const createManagedUserSchema = createManagedUserFieldsSchema.refine(
	(value) => value.password === value.confirmPassword,
	{
		path: ["confirmPassword"],
		message: "Пароли не совпадают.",
	}
);

export type CreateManagedUserInput = z.infer<typeof createManagedUserSchema>;

export const updateManagedUserRoleSchema = z.object({
	userId: z.string().uuid("Некорректный идентификатор пользователя."),
	role: assignableUserRoleSchema,
});

export type UpdateManagedUserRoleInput = z.infer<typeof updateManagedUserRoleSchema>;

export const bootstrapSuperuserSchema = z.object({
	login: loginValueSchema,
	password: registrationPasswordSchema,
});

export const bootstrapSuperusersSchema = z
	.array(bootstrapSuperuserSchema)
	.length(3, "Должно быть сконфигурировано ровно 3 суперпользователя.");

export type BootstrapSuperuser = z.infer<typeof bootstrapSuperuserSchema>;

export type ManagedUserView = {
	id: string;
	login: string;
	role: UserRole;
	status: UserStatus;
	createdAt: string;
	reviewedAt: string | null;
};

export type ManagedUsersView = {
	pending: ManagedUserView[];
	active: ManagedUserView[];
	rejected: ManagedUserView[];
};

export const roleLabels: Record<UserRole, string> = {
	"user": "Пользователь",
	"admin": "Админ",
	"super-admin": "Супер-админ",
};

export const statusLabels: Record<UserStatus, string> = {
	pending: "Ожидает подтверждения",
	active: "Активен",
	rejected: "Отклонён",
};

export function canEditProgress(role: UserRole) {
	return role === "super-admin";
}

export function canEditInstallation(role: UserRole) {
	return role === "super-admin";
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

export function canManageUsers(role: UserRole) {
	return role === "super-admin";
}

export const AUTH_COOKIE_NAME = "spider_viewer_session";
