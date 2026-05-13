import { describe, expect, it } from "vitest";

import {
	bootstrapSuperusersSchema,
	canEditInstallation,
	canEditProgress,
	createManagedUserSchema,
	normalizeLogin,
	registerSchema,
} from "./shared";

describe("auth shared rules", () => {
	it("normalizes login values before persistence", () => {
		expect(normalizeLogin("  MiXeD.Login  ")).toBe("mixed.login");
	});

	it("requires matching passwords during registration", () => {
		expect(() =>
			registerSchema.parse({
				login: "worker-1",
				password: "Password123!",
				confirmPassword: "Password1234!",
			})
		).toThrow(/не совпадают/i);
	});

	it("requires exactly three configured superusers", () => {
		expect(() =>
			bootstrapSuperusersSchema.parse([
				{ login: "super-1", password: "Password123!" },
				{ login: "super-2", password: "Password456!" },
			])
		).toThrow(/ровно 3/i);
	});

	it("allows super-admins to create users only with assignable roles", () => {
		expect(
			createManagedUserSchema.parse({
				login: "worker-1",
				password: "Password123!",
				confirmPassword: "Password123!",
				role: "super-admin",
			}).role
		).toBe("super-admin");

		expect(() =>
			createManagedUserSchema.parse({
				login: "worker-2",
				password: "Password123!",
				confirmPassword: "Password123!",
				role: "admin",
			})
		).toThrow();
	});

	it("allows editing only for super-admin", () => {
		expect(canEditProgress("super-admin")).toBe(true);
		expect(canEditProgress("user")).toBe(false);
		expect(canEditProgress("admin")).toBe(false);
		expect(canEditInstallation("super-admin")).toBe(true);
		expect(canEditInstallation("user")).toBe(false);
		expect(canEditInstallation("admin")).toBe(false);
	});
});
