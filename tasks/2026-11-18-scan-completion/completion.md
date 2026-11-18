# Scan completion repair

Status: local implementation and planned checks complete; not published or deployed.

Root cause confirmed in source: scan imports forced progress=null; existing attachments never invoked OCR. Real browser reproduction on original page rendered to PNG found 29 candidates but zero textual plus completions. User clarified that a plus means the entire cable is complete, replacing the earlier room-only interpretation.

Changes: margin connected-component cross detection with conservative single-row alignment; editable completion review; completion on new imports and existing-card uploads; existing-card matching restricted to card membership; missing/ambiguous rows reject transaction; unchecked rows preserve progress; archive and own-column permission rechecked under row lock. Batched 500-ID updates. Reimport reuses original card and permits updated flags. No migration or new dependencies.

Evidence by AC:

- AC-01: text regression failed before change, passes after; image detector and ambiguous row checks pass; UI test verifies initial plus flag, edits invalidate review, corrected flags sent only after explicit confirmation.
- AC-02: PostgreSQL verifies new-card item completion and progress100, unchanged30 on unchecked cable.
- AC-03: PostgreSQL verifies existing-card completion, same original/card reuse and atomic rejection with one valid and one missing cable.
- AC-04: existing PostgreSQL own-column, stage race, archive failure, private download and history-cleanup tests remain passing.

Fresh checks (Bun1.4.4): typecheck0; test84pass/45skip/0fail; test:integration22pass/7skip/0fail using disposable PostgreSQL18 spider_scan_test; lint/format0 (existing Date purity warning); build0. Integration archive and S3 streams mocked; no production S3 or deployed UI test. Storage/Redis/auth suites not enabled in this repair. No independent review performed; separate requirements and implementation self-review found and addressed duplicate-original handling, bounded updates and static circular dependency.

Browser image smoke: original PDF page1 rendered with Poppler to3000px, Chromium auto-rotation90,29 candidates,22completion candidates,0read errors. This is a candidate count, not accuracy: spurious/missing cable markings remain and all flags require review. Margin detector only searches outer6percent and may miss joined, diagonal, interior or ambiguous handwriting. No full annotated ground truth for all16pages. Original PDF browser run: all16pages auto-rotated90,0read errors,516candidate rows and265completion candidates. First-page manual reference has27cables with pluses:25correct markings,2missing and3extra candidates;20correct completion candidates. This is incomplete recognition and requires review; it is not production acceptance or a full-document accuracy score.

Publication authorized by user on 2026-11-18: publish to GitHub and Railway. Fresh lint, typecheck, unit tests and production build passed before publication; source fingerprint matches the earlier PostgreSQL and browser evidence. Git publication and Railway deployment are being performed as a separate release step. Branch fix/scanned-task-completion from origin/main048755b. Private scan/results stored only in /tmp/spider-scan-repair; never committed. Source fingerprint and exact file set in evidence.json. Deployment result is verified against the published commit and reported separately.
