import { createServerFn } from "@tanstack/react-start";

import { requireRole } from "./guards";
import {
	createManagedUserSchema,
	loginSchema,
	registerSchema,
	updateManagedUserRoleSchema,
	userModerationSchema,
} from "./shared";

export const getCurrentSession = createServerFn({ method: "GET" }).handler(async () => {
	const { getCurrentSession } = await import("./server");
	return getCurrentSession();
});

export const getAuthBootstrapState = createServerFn({ method: "GET" }).handler(async () => {
	const { getAuthBootstrapState } = await import("./server");
	return getAuthBootstrapState();
});

export const login = createServerFn({ method: "POST" })
	.inputValidator(loginSchema)
	.handler(async ({ data }) => {
		const { loginWithCredentials } = await import("./server");
		return loginWithCredentials(data);
	});

export const registerUser = createServerFn({ method: "POST" })
	.inputValidator(registerSchema)
	.handler(async ({ data }) => {
		const { registerWithCredentials } = await import("./server");
		return registerWithCredentials(data);
	});

export const createManagedUser = createServerFn({ method: "POST" })
	.inputValidator(createManagedUserSchema)
	.handler(async ({ data }) => {
		const creator = await requireRole(["super-admin"]);
		const { createManagedUser } = await import("./server");
		return createManagedUser(data, creator);
	});

export const updateManagedUserRole = createServerFn({ method: "POST" })
	.inputValidator(updateManagedUserRoleSchema)
	.handler(async ({ data }) => {
		const reviewer = await requireRole(["super-admin"]);
		const { updateManagedUserRole } = await import("./server");
		return updateManagedUserRole(data, reviewer);
	});

export const getManagedUsers = createServerFn({ method: "GET" }).handler(async () => {
	await requireRole(["super-admin"]);
	const { getManagedUsers } = await import("./server");
	return getManagedUsers();
});

export const approveUserRegistration = createServerFn({ method: "POST" })
	.inputValidator(userModerationSchema)
	.handler(async ({ data }) => {
		const reviewer = await requireRole(["super-admin"]);
		const { approvePendingUser } = await import("./server");
		return approvePendingUser(data.userId, reviewer);
	});

export const rejectUserRegistration = createServerFn({ method: "POST" })
	.inputValidator(userModerationSchema)
	.handler(async ({ data }) => {
		const reviewer = await requireRole(["super-admin"]);
		const { rejectPendingUser } = await import("./server");
		return rejectPendingUser(data.userId, reviewer);
	});

export const logout = createServerFn({ method: "POST" }).handler(async () => {
	const { logout } = await import("./server");
	await logout();

	return { success: true };
});
