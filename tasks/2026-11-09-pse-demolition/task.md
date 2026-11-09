# PSE cable base in demolition

Status: implementation. Base: 0d0c23f704c5727c2dd3ba833407d8623c75df2b.
Existing user change: src/lib/cable-map/functions.ts; preserve it.
Risk: elevated (cable identity and imported state). No schema, production data or deployment changes.

## Requirements and acceptance

Source: attached workbook structure and owner's instruction to place everything in clean zones.
AC-01: recognize PSE headers after summary row on Лист1; import all 7,326 data rows into clean/clean, both zones ЧЗ.
AC-02: preserve marking, journal, number, rooms, equipment, length and route; use Z начало for level, explicitly label absent levels. Distinct markings with repeated journal/number must have distinct stable canonical keys.
AC-03: existing Общ import and invalid-file rejection remain available.

## Flow and solution

SnapshotImportForm → uploadWorkbook → ensureUploadFile → parseWorkbookRows → canonical resolver → transactional cables/snapshot/rows/groups → dashboard.
Add a header-recognized PSE adapter before the legacy parser. Keep legacy rawRow layout for existing consumers. Preserve source row numbers. Explicit identity discriminator only for new format. No inferred shaft from route identifiers.

## Scenarios and verification

Normal: synthetic workbook with real header layout, clean zones and explicit values.
Empty: absent Z is «Уровень не указан»; empty rows skipped, no cable marking yields no row.
Boundary: zero and negative elevation preserved; decimal length supported; source row offsets retained.
Invalid: missing required PSE header does not activate adapter; legacy validation remains.
Large: original attachment checked locally, not copied into Git.
Repeat: deterministic canonical keys; duplicate journal numbers with different markings remain separate.
Concurrency/partial failure: unchanged existing DB transaction; parser pure, no side effects.
Compatibility: existing Общ tests. DB integrations need isolated services; no working DB used.
Checks: failing regression before fix, targeted tests, lint:check, test, build, typecheck and diff review. Independent acceptance remains owner's responsibility; self-review is not independent review.

## Publication request

Owner requested fetching latest Git version before pushing local changes. Fetch and fast-forward main to fed60be, preserve all intended local changes, verify combined state, commit and push origin/main. The incoming UI commit contains unused imports; removing them is necessary for existing required checks. No deployment or database import is part of this publication step.
