# PSE demolition import result

## Behavior and acceptance

Source state: 0d0c23f704c5727c2dd3ba833407d8623c75df2b plus changes to import.server.ts, import.server.test.ts and snapshot-import-form.tsx. Existing functions.ts user edit preserved. Requirements: [task.md](task.md).

- AC-01 confirmed at parser boundary: original attachment produces 7,326 rows, all clean/clean and both zones ЧЗ.
- AC-02 confirmed at parser/key boundary: 7,326 distinct canonical keys; original total 546,525 m preserved; 158 unspecified levels labeled explicitly. Missing rooms do not drop cable rows. Source row indices preserved. Explicit identity suffix distinguishes markings with repeated journal/number; original journal/number unchanged. Normalized rawRow matches legacy consumer layout; original bytes remain archived by existing upload flow.
- AC-03 confirmed: existing XLSX/ODS and invalid input tests pass. UI describes new support.

## Verification

Environment: Bun 1.4.4 via npx (default installed Bun was 1.4.2). Installed missing lockfile dependency fake-indexeddb using bun install --frozen-lockfile; lockfile unchanged.

Before fix: new synthetic regression failed with missing Общ sheet. After fix: regression passes.

Final application code:

- `npx -y -p bun@1.4.4 -c 'bun run lint:check'`: exit 0; pre-existing render Date purity warning in group-progress-sheet.tsx.
- `npx -y -p bun@1.4.4 -c 'bun run test'`: exit 0, 74 pass, 32 skip, 0 fail. Skips require external auth/workflow/storage test services.
- `npx -y -p bun@1.4.4 -c 'bun run typecheck'`: exit 0.
- `npx -y -p bun@1.4.4 -c 'bun run build'`: exit 0.
- `npx -y bun@1.4.4 tasks/2026-11-09-pse-demolition/verify-attachment.ts <original attachment>`: exit 0; aggregate expectations above.
- `git diff --check`: exit 0.

Two self-review passes covered requirements and implementation. Review caught identity stripping before lookup of cableId; fixed before final checks. No independent review performed; self-review is not independent acceptance. No workbook data copied into Git fixtures.

## Limits and next step

Status: implemented, verification incomplete at database/application boundary.
Real PostgreSQL/S3 import not executed. Configured DB is localhost, Docker daemon unavailable; disposable test DB not configured. The real attachment was parsed without writing working data. No deployment, commit or push performed. Owner must run integration acceptance and load the workbook in the updated application. Database schema/transaction structure unchanged; rollback is code rollback before import. Existing data are not modified by this task.

## Git synchronization and publication preparation

Owner subsequently authorized Git push after obtaining latest remote version. Fetched origin/main and fast-forwarded from 0d0c23f to fed60be; temporarily stashed local tracked/untracked files and restored them without conflicts. Included existing functions.ts validator change in the intended snapshot. Removed unused Card imports in two UI files introduced by fed60be, which otherwise failed lint/typecheck.

On combined state: lint:check, typecheck, test and build pass; tests remain 74 pass / 32 skip / 0 fail. Attachment verification still confirms all 7,326 rows in clean zones and 546,525 m. Existing Date purity warning remains. Full diff reviewed for requirements and implementation. This authorizes Git publication only; database/application acceptance limits above remain.
