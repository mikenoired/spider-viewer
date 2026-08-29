import { describe, expect, it } from "vitest";

import type { AuthSession } from "@/lib/auth/shared";

import { getAllowedImportStages } from "./task-workflow.server";

function session(department: AuthSession["department"], role: AuthSession["role"] = "user"): AuthSession {
	return { id: "00000000-0000-4000-8000-000000000001", login: "tester", role, department };
}

describe("Kanban import permissions", () => {
	it("allows MASTER to select any of the five stages", () => {
		expect(getAllowedImportStages(session("tai", "super-admin"))).toEqual([
			"formed",
			"in_progress",
			"curator_review",
			"adjustment",
			"done",
		]);
	});

	it("limits TAI and commissioning to their configured stages", () => {
		expect(getAllowedImportStages(session("tai"))).toEqual(["formed", "curator_review"]);
		expect(getAllowedImportStages(session("commissioning"))).toEqual(["adjustment"]);
		expect(getAllowedImportStages(session("skm"))).toEqual([]);
	});
});
