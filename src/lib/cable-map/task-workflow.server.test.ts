import { describe, expect, it } from "vitest";

import type { AuthSession } from "@/lib/auth/shared";
import { splitKanbanTaskSchema } from "@/lib/cable-map/shared";

import { createImportableTaskMatches, getAllowedImportStages } from "./task-workflow.server";

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

	it("requires at least one rejected position for a partial acceptance", () => {
		expect(() =>
			splitKanbanTaskSchema.parse({
				listId: "00000000-0000-4000-8000-000000000001",
				rejectedCableIds: [],
			})
		).toThrow();
		expect(
			splitKanbanTaskSchema.parse({
				listId: "00000000-0000-4000-8000-000000000001",
				rejectedCableIds: ["00000000-0000-4000-8000-000000000002"],
			})
		).toMatchObject({ rejectedCableIds: ["00000000-0000-4000-8000-000000000002"] });
	});

	it("keeps only one importable row per matched cable", () => {
		const result = createImportableTaskMatches([
			{
				cableId: "cable-1",
				parsed: {
					rowIndex: 2,
					cableLabel: "A",
					cableJournal: "",
					cableNumber: "",
					fromRoom: "",
					toRoom: "",
					progress: null,
				},
			},
			{
				cableId: "cable-1",
				parsed: {
					rowIndex: 3,
					cableLabel: "A duplicate",
					cableJournal: "",
					cableNumber: "",
					fromRoom: "",
					toRoom: "",
					progress: 50,
				},
			},
			{
				cableId: "cable-2",
				parsed: {
					rowIndex: 4,
					cableLabel: "B",
					cableJournal: "",
					cableNumber: "",
					fromRoom: "",
					toRoom: "",
					progress: null,
				},
			},
		]);

		expect(result.duplicateCount).toBe(1);
		expect(result.matches.map((match) => match.cableId)).toEqual(["cable-1", "cable-2"]);
		expect(result.matches[0].parsed.rowIndex).toBe(2);
	});
});
