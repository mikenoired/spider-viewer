import { describe, expect, it } from "bun:test";

import {
	assertTaskDocumentStage,
	documentCableRowsSchema,
	extractDocumentCableRows,
	getTaskDocumentStage,
	validateTaskDocument,
} from "./task-documents";

describe("Kanban documents", () => {
	it("allows every department only its own column, with no role bypass", () => {
		const columns = ["formed", "in_progress", "curator_review", "adjustment", "done"];
		for (const department of ["tai", "skm", "commissioning", "curator"] as const) {
			const expected = (
				{ tai: "formed", skm: "in_progress", commissioning: "adjustment", curator: null } as const
			)[department];
			expect(getTaskDocumentStage({ department })).toBe(expected);
			for (const column of columns) {
				if (column === expected) expect(() => assertTaskDocumentStage({ department }, column)).not.toThrow();
				else expect(() => assertTaskDocumentStage({ department }, column)).toThrow("свой столбец");
			}
		}
	});
	it("checks file signatures, sizes and MIME rather than extensions alone", async () => {
		await expect(
			validateTaskDocument(new File(["%PDF-1.7"], "task.pdf", { type: "application/pdf" }))
		).resolves.toMatchObject({ contentType: "application/pdf" });
		await expect(
			validateTaskDocument(
				new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "task.png", { type: "image/png" })
			)
		).resolves.toMatchObject({ contentType: "image/png" });
		for (const file of [
			new File(["<script>"], "task.pdf"),
			new File([], "task.png"),
			new File(["%PDF-"], "task.pdf", { type: "image/png" }),
			new File(["%PDF-"], "task.svg"),
		]) {
			await expect(validateTaskDocument(file)).rejects.toThrow();
		}
	});
	it("preserves distinct complete cable markings without turning equipment or pluses into completion", () => {
		const rows = extractDocumentCableRows(
			"0012 1HX98k176 тип 5x1 + 1HX98 1HX29 000012345\n0013 1HX48-01 +",
			2
		);
		expect(rows.map((row) => row.cableLabel)).toEqual(["1HX98K176", "1HX48-01"]);
		expect(rows[0]?.cableNumber).toBe("0012");
		expect(rows[0]?.page).toBe(2);
		expect(rows[0]).not.toHaveProperty("progress");
		expect(documentCableRowsSchema.parse([{ ...rows[0], progress: 100 }])[0]).not.toHaveProperty("progress");
		expect(() => documentCableRowsSchema.parse([{ page: 0, cableLabel: "1HX98K176" }])).toThrow();
	});
});
