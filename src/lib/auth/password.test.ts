import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

describe("password helpers", () => {
	it("hashes and verifies a valid password", async () => {
		const password = "Password123!";
		const hash = await hashPassword(password);

		expect(hash).toContain(":");
		expect(await verifyPassword(password, hash)).toBe(true);
	});

	it("rejects an invalid password", async () => {
		const hash = await hashPassword("Password123!");

		expect(await verifyPassword("WrongPassword123!", hash)).toBe(false);
	});
});
