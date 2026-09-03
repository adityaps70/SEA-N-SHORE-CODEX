# AuditOS SIRE↔SMS Gap Analysis — Design

Date: 2026-09-04
Branch: `auditos-gap-vercel-source`

## Goal

Build one focused Vercel-hosted AuditOS feature that lets an auditor upload a company SMS PDF and a SIRE Excel workbook, automatically maps each SIRE item to relevant SMS pages/sections, classifies coverage, prioritizes review, supports gap challenge and auditor decisions, and exports results.

This is a document-gap intelligence tool. It must never convert missing material into a compliance conclusion.

## Scope

### Included

- Upload one company SMS PDF.
- Upload one SIRE Excel workbook (`.xlsx` / `.xls`).
- Parse both files locally in the browser.
- Preserve PDF page numbers.
- Detect workbook sheets and likely column roles without assuming a fixed schema.
- Map SIRE items to likely SMS pages/sections.
- Show exact SIRE reference/text and matched SMS page excerpts.
- Classify each SIRE item as:
  - Strong Coverage
  - Partial Coverage
  - Possible Gap
  - No Relevant Control Located
  - Needs Auditor Review
- Show match confidence.
- Show what appears covered and what remains unproved.
- Show next verification actions.
- Priority review list.
- Search and filter results.
- Challenge Gap: broaden search using synonyms, nearby pages, cross-references and alternate terms.
- Auditor decision state:
  - Confirmed Gap
  - Dismissed
  - Needs Verification
  - Unreviewed
- Open SMS source at matched page inside the browser.
- Export result set to CSV.
- Persist working analysis locally on the device.
- No login, no Supabase, no demo data.

### Explicitly excluded

- Findings/CAPA workflow.
- Company-wide user management.
- Remote database storage.
- Automatic compliance/non-compliance decisions.
- SIRE content supplied by AuditOS itself.
- Reproduction of proprietary SIRE text beyond what the user uploads.
- Broader AuditOS modules.

## User Workflow

1. Auditor opens AuditOS Gap Analysis.
2. Uploads the company SMS PDF.
3. Uploads the SIRE Excel workbook.
4. AuditOS parses both locally.
5. AuditOS shows detected Excel structure and allows the user to confirm/edit mapped columns if confidence is low.
6. Auditor clicks **Run SIRE↔SMS Gap Analysis**.
7. AuditOS analyses every eligible SIRE row against the SMS page index.
8. Results are shown as a priority review list.
9. Auditor opens any SIRE item to inspect matched pages/excerpts.
10. Auditor may click **Challenge Gap** for a broader second-pass search.
11. Auditor sets a review decision.
12. Auditor exports CSV.

## Architecture

### Browser-first processing

The core file processing stays in the browser to avoid Vercel request/upload limits and to reduce exposure of confidential company SMS content.

- PDF parsing: browser-side PDF parser with per-page text extraction.
- Excel parsing: browser-side workbook parser.
- Mapping engine: browser-side lexical/semantic-lite scoring using normalized tokens, phrase overlap, headings, section proximity, synonyms and weighted fields.
- Local persistence: IndexedDB or localStorage depending payload size.
- PDF viewing: original uploaded PDF retained as an object URL in the current browser session; page targeting is preserved.

No document is uploaded to a server in the deterministic core flow.

### Optional Vercel AI enrichment

A Vercel serverless endpoint may optionally receive only the selected SIRE item plus selected SMS excerpts for:

- Challenge Gap
- coverage explanation
- alternate terminology suggestions
- contradiction review

AI must not receive the whole SMS unless explicitly required by a future design. The deterministic mapper must remain usable without AI.

If AI credentials are unavailable, Challenge Gap falls back to a broader deterministic search.

## SIRE Excel Detection

AuditOS must inspect all sheets and infer likely columns by header names and cell patterns.

Likely semantic roles:

- Reference / Question ID
- Section / Topic
- Question / Requirement text
- Guidance / Notes
- Rank / Role
- Applicability
- Vessel type
- Expected evidence
- Interview role
- Risk / Category

Detection rules:

- Never silently discard unknown columns.
- Preserve original sheet name and row number.
- If mapping confidence is low, show a column-mapping confirmation panel before analysis.
- At minimum, one text-bearing requirement/question column must be selected.
- Reference may be synthesized from sheet + row if no explicit reference exists, but this must be labelled as a generated internal reference.

## SMS PDF Processing

For every PDF page, store:

- page number
- raw extracted text
- normalized searchable text
- probable heading(s)
- probable section/chapter numbers
- detected revision/effective-date phrases when present
- nearby cross-reference terms

The system must preserve the original PDF page number used in the uploaded file.

## Mapping Engine

For each SIRE row, build a search query from weighted fields:

1. Question/requirement text — highest weight
2. Section/topic — high weight
3. Guidance/expected evidence — medium weight
4. Rank/applicability/category — low contextual weight

### Candidate retrieval

Score each SMS page using:

- exact phrase overlap
- normalized token overlap
- maritime keyword overlap
- heading match
- section number/reference match
- synonym expansion
- adjacent-page bonus
- repeated cross-reference bonus

Keep top candidates above a minimum threshold and include adjacent pages when the match appears to span a procedure section.

### Coverage classification

The mapper does not determine compliance. It estimates document coverage only.

- **Strong Coverage**: clear, high-confidence match with substantial concept overlap and no obvious missing control elements from the uploaded SIRE text.
- **Partial Coverage**: relevant SMS control located but important concepts from the SIRE item are weak/missing.
- **Possible Gap**: weak or fragmented matches; an expected concept is not clearly supported.
- **No Relevant Control Located**: no candidate exceeds the minimum retrieval threshold.
- **Needs Auditor Review**: ambiguous or conflicting matches, low-confidence schema inference, or multiple plausible controls requiring judgement.

All classifications must display: `Document coverage only — not a compliance conclusion.`

## Gap Detail View

Each SIRE result shows:

- SIRE reference
- original sheet and row
- SIRE section/topic
- SIRE question/requirement text
- detected applicability metadata
- coverage classification
- confidence percentage
- matched SMS pages
- SMS heading/section if detected
- SMS excerpt(s)
- why the mapper selected them
- concepts that appear covered
- concepts still not clearly supported
- next verification actions
- auditor decision

### Source traceability

Every matched excerpt must include its PDF page number.

The UI must never show an unsupported SMS clause reference generated by the model. Section labels are displayed only if extracted from the PDF text.

## Challenge Gap

Challenge Gap attempts to disprove or downgrade a suspected gap before the auditor accepts it.

Second-pass search expands:

- synonyms and maritime equivalents
- abbreviations
- related procedure terminology
- cross-referenced form names
- nearby pages
- likely chapter headings

Possible outcomes:

- Gap remains
- Additional control located
- Classification downgraded/upgraded
- Needs Auditor Review

The challenge result must list newly located pages and explain why the classification changed.

## Priority Review

The default results view prioritizes:

1. No Relevant Control Located
2. Possible Gap
3. Partial Coverage
4. Needs Auditor Review
5. Strong Coverage

A risk-attention boost may be applied for high-attention maritime topics such as enclosed space entry, navigation, ECDIS, mooring, cargo, fire safety, emergency systems, steering, gas testing, permits, lifesaving, critical machinery and alarms.

This boost affects review order only, not compliance status.

## UI

Single-purpose premium maritime enterprise interface.

### Upload state

Two prominent cards:

- `1. Upload Company SMS PDF`
- `2. Upload SIRE Excel`

Then a disabled/enabled `Run SIRE↔SMS Gap Analysis` button.

Show parsing progress:

- PDF pages processed
- workbook sheets detected
- SIRE rows detected
- detected column mapping

### Results state

Summary strip:

- SIRE items analysed
- Strong Coverage
- Partial Coverage
- Possible Gap
- No Control Located
- Needs Review

Main area:

- search
- filters
- priority review list
- result detail drawer/panel

Result cards must be compact enough for hundreds of questions.

## Data Privacy

- Uploaded files remain in the browser for deterministic processing.
- No company SMS or SIRE workbook is persisted to Vercel storage.
- Local persistence stores derived text/index/result data only on the auditor's device.
- Provide a clear `Clear Analysis` action that removes all local state.
- If optional AI enrichment is invoked, send only the selected SIRE item and selected SMS excerpts necessary for that request.

## Error Handling

- Password-protected or unreadable PDF: show a clear unsupported-file message.
- Scanned/image-only PDF with no extractable text: state that text extraction is insufficient and do not fabricate results. OCR is not part of this first version.
- Malformed workbook: show workbook parsing error.
- Multiple sheets: analyse all usable sheets unless the auditor deselects one.
- Unknown column structure: require user confirmation of the question/requirement column.
- Very large files: process incrementally and show progress; avoid freezing the page.
- No mapping candidates: classify as `No Relevant Control Located`, never as non-compliant.

## Testing Strategy

Automated tests use generated fixtures, not proprietary SIRE data.

### PDF fixture

Generate a small text PDF with known pages/sections:

- Enclosed Space Entry
- Gas Testing
- Mooring
- Navigation
- Emergency Response

### Excel fixture

Generate a workbook with multiple sheets and varied headers:

- question IDs
- requirement text
- guidance
- role/rank
- applicability

### Required automated coverage

- PDF page extraction preserves page numbers.
- Excel auto-detection maps expected columns.
- Unknown Excel schema requests confirmation.
- Mapping retrieves the correct page for a known question.
- Weak matches classify as Partial/Possible Gap.
- No matches classify as No Relevant Control Located.
- Challenge Gap broadens retrieval and can find a synonym-based control.
- Review decision persists locally.
- CSV export contains SIRE reference, classification, confidence, SMS pages and auditor decision.
- No path labels missing evidence as non-compliance.
- App works without AI credentials.

## Deployment

Deploy on Vercel from the isolated `auditos-gap-vercel-source` branch. Do not modify the Sea N Shore `main` branch.

The deployment must remain a single-purpose AuditOS Gap Analysis experience.

## Success Criteria

The build is ready for user testing when:

1. User can open the Vercel URL without Supabase/login dependency.
2. User can upload a real text-based SMS PDF.
3. User can upload a real SIRE Excel workbook.
4. AuditOS detects workbook structure and SIRE rows.
5. AuditOS maps SIRE rows to SMS pages with source traceability.
6. Results show coverage classes and prioritized review.
7. Challenge Gap works with deterministic fallback.
8. Auditor can mark decisions and export CSV.
9. Missing source material is never labelled non-compliance.
10. Tests pass and the Vercel deployment is verified before completion is claimed.
