import { strict as assert } from "node:assert";

import { getCableExternalKey, parseWorkbookRows } from "../../src/lib/cable-map/import.server";

const path = process.argv[2];
assert(path, "Pass the original PSE workbook path");
const rows = parseWorkbookRows("base.xlsx", Buffer.from(await Bun.file(path).bytes()));
assert.equal(rows.length, 7326);
assert.equal(new Set(rows.map(getCableExternalKey)).size, 7326);
assert(rows.every((row) => row.graphSide === "clean" && row.graphSubzone === "clean"));
assert(rows.every((row) => row.fromZone === "ЧЗ" && row.toZone === "ЧЗ"));
assert.equal(
	rows.reduce((sum, row) => sum + row.totalLength, 0),
	546525
);
assert.equal(rows.filter((row) => row.level === "Уровень не указан").length, 158);
process.stdout.write("7326 rows, 7326 identities, all clean, 546525 m, 158 unspecified levels\n");
