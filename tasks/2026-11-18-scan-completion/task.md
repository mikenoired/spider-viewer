# Scan completion repair

Status: local implementation verified; not deployed. Base: origin/main 048755b; clean initial tree.
Source: user reports scans are not read and cables not completed; explicit clarification: a plus against a row means the entire cable is complete.
Risk: elevated, production progress data. No deployment or publication authorized for this repair.
AC-01: OCR plus candidates have editable completion checkboxes and explicit review.
AC-02: confirmed completed rows set cable progress to 100 and Kanban item completion atomically; unchecked rows preserve progress.
AC-03: existing-card uploads optionally recognize and apply confirmed rows only to cables in that card; ambiguous/missing rows reject without partial progress writes. Plain attachment remains available.
AC-04: enforce own-column upload restrictions under lock; errors and original archive remain explicit.
Flow: PDF/image -> browser OCR -> editable reviewed rows -> server Zod validation -> existing cable matching -> transaction with attachment/audit/completion.
Inputs: plus/no plus, date/arithmetic plus, missing/ambiguous labels, duplicate file, cancelled OCR, S3 failure, stage race, old reviewedRows lacking completion field, max5000 rows.
Verification: regression parser tests before/after; PostgreSQL new/existing-card completion, unchanged unchecked progress and invalid-row atomicity; lint/typecheck/build. Original sample browser accuracy requires actual rerun; never equate candidates with correct rows.
Recovery: no migration, revert code; progress changes audited with row payload. Manual review required for OCR handwriting.
