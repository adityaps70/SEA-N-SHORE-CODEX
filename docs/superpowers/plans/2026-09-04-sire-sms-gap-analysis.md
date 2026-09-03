# SIRE↔SMS Gap Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working Vercel-hosted AuditOS flow where an auditor uploads an SMS PDF and SIRE Excel workbook and receives source-traceable document-coverage gap analysis with challenge, review decisions, and CSV export.

**Architecture:** Keep confidential file parsing in the browser. `pdfjs-dist` reads the SMS per page and `xlsx` reads the workbook. Pure modules handle Excel schema inference, normalized maritime search, page scoring, coverage classification, challenge search, and CSV serialization. The Vercel app stores only local browser state and never converts missing source material into a compliance conclusion.

**Tech Stack:** Browser JavaScript modules, PDF.js, SheetJS/XLSX, Node built-in test runner for pure logic, Vercel static deployment.

**Spec:** `docs/superpowers/specs/2026-09-04-sire-sms-gap-analysis-design.md`

## Global Constraints

- Deploy from `auditos-gap-vercel-source`; do not modify Sea N Shore `main`.
- No login, Supabase, remote database, demo company data, findings, or CAPA modules.
- User-supplied SIRE content remains user-supplied; AuditOS does not bundle proprietary question text.
- Missing SMS material must be labelled `No Relevant Control Located` or another document-coverage state, never non-compliance.
- Preserve original PDF page numbers and Excel sheet/row traceability.
- Core mapping and Challenge Gap must work without AI credentials.
- Uploaded SMS/SIRE files are parsed in-browser and not persisted to Vercel storage.

---

### Task 1: Pure Excel schema inference

**Files:**
- Create: `auditos/core/excel-schema.js`
- Create: `auditos/tests/excel-schema.test.mjs`

**Interfaces:**
- Produces: `inferColumnMapping(headers, sampleRows)` returning `{ mapping, confidence, needsConfirmation, scores }`.
- Produces: `normalizeSireRows(sheetName, rows, mapping)` returning normalized SIRE items with `sourceSheet` and `sourceRow`.

- [ ] Write failing tests for common headers (`Question No`, `Section`, `Question`, `Guidance`, `Rank`, `Applicability`) and an ambiguous workbook requiring confirmation.
- [ ] Run `node --test auditos/tests/excel-schema.test.mjs` and verify failure because module does not exist.
- [ ] Implement weighted header aliases plus sample-cell pattern scoring.
- [ ] Run the test and verify pass.
- [ ] Commit `feat: infer SIRE workbook structure`.

### Task 2: Pure SMS page index and SIRE→SMS mapper

**Files:**
- Create: `auditos/core/mapper.js`
- Create: `auditos/tests/mapper.test.mjs`

**Interfaces:**
- Consumes normalized SIRE items and SMS pages `{ pageNumber, text, heading, section }`.
- Produces: `mapSireItem(item, pages, options)` returning `{ classification, confidence, matches, coveredConcepts, unsupportedConcepts, nextActions, priority }`.
- Produces: `challengeMapping(item, pages, currentResult)` for a broader deterministic second pass.

- [ ] Write failing tests for exact topic match, heading match, synonym match, partial coverage, no control located, adjacent-page retrieval, and risk-attention ordering.
- [ ] Run `node --test auditos/tests/mapper.test.mjs` and verify failure.
- [ ] Implement normalization, stop-word filtering, maritime synonym expansion, weighted token/phrase/heading scoring, top-page selection, adjacent-page bonus, and conservative coverage thresholds.
- [ ] Implement `challengeMapping` using expanded synonyms, lower retrieval threshold, nearby pages, and cross-reference terms.
- [ ] Run mapper tests and verify pass.
- [ ] Commit `feat: map SIRE requirements to SMS pages`.

### Task 3: Review decisions and CSV export

**Files:**
- Create: `auditos/core/export.js`
- Create: `auditos/tests/export.test.mjs`

**Interfaces:**
- Produces: `toCsv(results)` containing SIRE reference, sheet, row, classification, confidence, matched PDF pages, auditor decision, and unresolved concepts.
- Produces: `applyDecision(result, decision)` restricted to `Unreviewed | Confirmed Gap | Dismissed | Needs Verification`.

- [ ] Write failing tests for decision validation, CSV escaping, matched page serialization, and no forbidden compliance wording.
- [ ] Run test and verify failure.
- [ ] Implement minimal decision and CSV helpers.
- [ ] Run tests and verify pass.
- [ ] Commit `feat: export reviewed gap analysis`.

### Task 4: Browser PDF and Excel adapters

**Files:**
- Create: `auditos/browser/parsers.js`
- Create: `auditos/tests/parser-contract.test.mjs`

**Interfaces:**
- Produces: `parseSmsPdf(file, onProgress)` using PDF.js and returning page objects with exact `pageNumber` and extracted text.
- Produces: `parseSireWorkbook(file)` using SheetJS and returning sheet rows plus inferred schema metadata.

- [ ] Write contract tests for parser exports, error codes, and conversion helpers that operate without browser globals.
- [ ] Run test and verify failure.
- [ ] Implement runtime library loaders for PDF.js and SheetJS, PDF text extraction, workbook-to-row conversion, progress callbacks, password/unreadable/image-only PDF detection, and workbook errors.
- [ ] Run parser contract tests and syntax checks.
- [ ] Commit `feat: parse SMS PDF and SIRE Excel in browser`.

### Task 5: Upload, mapping, review and challenge UI

**Files:**
- Create: `auditos/index.html`
- Create: `auditos/app.js`
- Create: `auditos/styles.css`
- Create: `auditos/tests/ui-contract.test.mjs`

**Interfaces:**
- Consumes Tasks 1-4.
- Provides user flow: upload SMS → upload SIRE → confirm inferred columns if needed → run analysis → inspect result → open matched SMS page → Challenge Gap → set auditor decision → export CSV → clear local state.

- [ ] Write failing UI contract tests for required IDs/copy: `smsFile`, `sireFile`, `runAnalysis`, `columnMapping`, `results`, `challengeGap`, `exportCsv`, and the `Document coverage only — not a compliance conclusion.` guardrail.
- [ ] Run test and verify failure.
- [ ] Implement premium single-purpose AuditOS upload screen and parsing progress.
- [ ] Implement summary counts, search/filter controls, priority list and traceable detail drawer.
- [ ] Implement Challenge Gap and review decisions.
- [ ] Implement `Open SMS page` using an object URL with `#page=N` and a fallback inline page/excerpt view.
- [ ] Persist derived analysis state locally; never persist raw file bytes.
- [ ] Implement CSV download and `Clear Analysis`.
- [ ] Run UI contract tests and syntax checks.
- [ ] Commit `feat: build SIRE SMS upload gap analysis UI`.

### Task 6: Vercel isolated deployment and verification

**Files:**
- Modify: `vercel.json`
- Modify: `package.json`
- Create/modify: branch build script as needed to emit only `auditos/` into the Vercel static output.

**Interfaces:**
- Produces a Vercel preview for `auditos-gap-vercel-source` that does not compile or deploy Sea N Shore application code.

- [ ] Add `npm test` covering all `auditos/tests/*.test.mjs` and a build command that copies `auditos/` into the configured output directory.
- [ ] Run all tests locally against the exact source files prepared for GitHub.
- [ ] Push changes on `auditos-gap-vercel-source` and wait for Vercel Git deployment.
- [ ] Verify Vercel deployment state is `READY` and live `/` returns the AuditOS upload UI.
- [ ] Verify no login/Supabase references in deployed HTML.
- [ ] Verify malformed/no-file state does not fabricate mappings.
- [ ] Record the immutable Vercel URL and branch alias/share URL if Deployment Protection is enabled.
- [ ] Commit any deployment-only corrections and re-run verification.
