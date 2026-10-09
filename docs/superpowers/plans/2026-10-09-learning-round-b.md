# Learning round B: assessments and certificates

Started 9 October 2026 from feature head `42767f1d` (after #174).

Ship plan: PR 1 = B1 + B2 + B3 + the round's migration; PR 2 = B4 + B5. Then one guarded migration run (0072–0073)
and one deploy for both. Owner merges every arm PR.

## Step 0 findings (verified against the code on 9 October)

| Item | Status before this round |
|---|---|
| B1 question bank | Missing: questions live only inside a quiz; no CSV import or export; no tags |
| B2 question types | Single-correct MCQ only, 1 point each, a unique index allows one correct option, answers need a selected option |
| B3 quiz settings | Pass mark, instructions and attempt limit only; no timer, shuffle, draw or answer policy; answers shown after every attempt |
| B4 certificates | One fixed layout (pdf-lib, Helvetica), `SNS-YYYY-<12 hex>` numbers, issued on course completion only, no expiry |
| B5 profile | Credentials are self-reported free text; Sea N Shore certificates are not on the profile; Jobs matching reads only self-reported credentials |

Grading queue: assignments only (Studio → Assignments). CSV: export helpers exist, no parser (one written here, no new
dependency). Roles: the Round 12 taxonomy is code only (`src/features/roles/taxonomy.ts`), so questions store its keys.

Owner decisions (9 October):
- Allow the three relaxations: bank questions without a quiz; one-correct-option becomes a per-type check; answers
  without a single selected option.
- A quiz holds its own copy of each question. Bank edits change future copies only; live quizzes change only through
  the reviewed draft; random draws pick from the quiz's own questions, set in the draft and reviewed.

## Migration (one guarded runner for the round)

- [x] `0072_learning_round_b_notification_types.sql`: in-app types for graded quiz answers and expiring certificates
- [x] `0073_learning_round_b.sql`: banks, question types and marks, tags, quiz settings, attempt sessions, answer
      grading, certificate builder columns, widened email kinds, bank backfill
- [x] `aws-learning-round-b-migration.yml` + `learning-round-b-migration.sh` + guard (plan) + contract test; the
      runner allows exactly the three relaxations, the widened email kind check and the two backfill links
- [x] Applies cleanly to every earlier migration in PGlite
- [x] Plan run on the merged head (previews 0073 in a rolled-back transaction, prints backfill counts)
- [x] Arm PR #177 (owner merged and approved), migrate-once in run 37944729794 (applied and verified: 3 banks,
      53 bank questions, 0 unlinked live questions), rearm to plan (`330c70bb`). The run shows red only because the
      workflow's evidence check required the plan-only PLAN_VERIFIED line (see "Runner template" below).

Backfill: every trainer with a live course gets a bank; every live quiz question of a live course is copied into it
with its options (`imported_from_question_id` = the original), and the quiz question links to its copy
(`source_question_id`). Open draft revisions link through `revision_source_id`. No prompt, option, attempt, answer
or certificate value changes; existing attempts keep `status = completed`, existing quizzes keep "show answers after
each attempt" (today's behaviour), existing certificates keep their layout (`template_key` null) and never expire.

## PR 1: B1 + B2 + B3

B1 — question bank
- [x] Studio → Question bank: list with filters (type, topic, difficulty, department, rank), add, edit, delete
- [x] Tags: topic, difficulty, department and rank from the Round 12 taxonomy
- [x] CSV import: template download, row-by-row validation, error report, nothing saved unless every row is valid
- [x] CSV export
- [x] Only the bank's trainer and platform admins can see it; learners never receive answers before submitting
- [x] Existing quiz questions in their trainer's bank, linked to their quizzes (backfill)

B2 — question types and marking
- [x] Single-correct, multiple-correct, true/false, fill-in-the-blank (accepted answers, optional case-sensitive),
      subjective
- [x] Marks per question, optional negative marks, explanation shown per the answer policy
- [x] Subjective answers: "Awaiting grading" for the learner; graded in the Studio grading queue; pass/fail,
      completion and the certificate wait for the grade

B3 — quiz settings
- [x] Timer enforced on the server: auto-submit at the deadline, late answers refused
- [x] Shuffle questions and/or options
- [x] Draw N random questions from the quiz's pool, fixed for the attempt
- [x] Answer policy: never / after each attempt / after passing / after the last attempt
- [x] Tests on real SQL: the timer can't be bypassed, the draw is stable in an attempt, answers never leak early

Also in PR 1:
- "Add from bank" in the quiz editor copies picked (or all filtered) bank questions into the quiz; the quiz keeps its
  own copy (`source_question_id` links back).
- Timed, shuffled or drawn quizzes run as server sessions: "Start quiz" draws the questions and sets the deadline,
  answers save as the learner goes, a reload resumes the same attempt, and an attempt whose time ran out while the
  learner was away is submitted hourly from its saved answers. Plain quizzes keep the old one-step submit.
- An attempt whose question was deleted by a reviewed edit is closed uncounted and started afresh.
- A trainer's bank is in their account export. Notifications: "graded your quiz answers" (in-app + Learning email).
- Not done: the hourly "submissions to grade" digest still counts assignments only; written quiz answers show in the
  same Studio queue.

## PR 2: B4 + B5

B4 — certificate builder
- [x] Three new layouts plus the original, logo and signature image, signatory, serial prefix, validity
- [x] Issue on course completion or on passing a chosen final quiz
- [x] Renewal reminders 30 and 7 days before expiry (Learning emails, members can opt out)
- [x] Verification page: holder, course, issued, valid until, Valid / Expired
- [x] Existing certificates keep their design, number and link, with no expiry

B5 — certificates on the profile
- [x] Credentials show Sea N Shore certificates: issuer, issued, expiry, link to the verification page, "Expired"
- [x] The member can hide any of them (shown by default)
- [x] Jobs matching counts visible Sea N Shore certificates as verified

PR 1: [#175](https://github.com/adityaps70/SEA-N-SHORE-CODEX/pull/175), merged as `b042c7a5`.
PR 2: [#176](https://github.com/adityaps70/SEA-N-SHORE-CODEX/pull/176), merged as `d9b289f0`.

Also in PR 2:
- Studio course editor → Certificate panel (works on drafts and draft revisions; reviewers see "Certificate design,
  validity and issuing" in the change list). Logo and signature are new learning media kinds (PNG/JPEG, 2 MB).
- A certificate copies the design, serial prefix, validity and signatory when issued; later course edits never
  change it. My Learning shows the download as soon as a certificate exists (final-quiz courses).

Follow-up before the deploy (owner, 9 October): Step 0 found a passed quiz could be resubmitted through the server
action (only the attempt limit was checked), and #175 had not fixed it.
- [x] Once a learner has passed, the server refuses new attempts (start, save, submit) with `quiz_already_passed`;
      a retry of the passing submission (same key) still returns it. Real-SQL tests for plain, timed and graded quizzes.
      [#178](https://github.com/adityaps70/SEA-N-SHORE-CODEX/pull/178), merged as `70b18870`.

Runner template (owner, 9 October): the round A list repair and round B runners required the plan-only
`PLAN_VERIFIED` line on every run, so their successful apply runs went red. Both runners are finished and stay as
they are.
- [x] `scripts/aws/templates/guarded-migration/`: a runner template (workflow, runner, contract test, `render.mjs`)
      whose evidence check requires only each path's own last line (plan → `PLAN_ONLY_NO_APPLY`, apply →
      `APPLY_VERIFIED=true`, nothing pending → `ALREADY_APPLIED=true`)
- [x] `guarded-migration-template.test.mjs` (Infra CI): renders a sample runner, runs its contract test, and runs
      the evidence check against plan, apply and nothing-pending output; it fails if the old check comes back

## Release

- [x] One guarded migration (0072–0073)
- [ ] One deploy, rearm, Remote Verify green. First attempt: arm #179 (deploy-once `70b18870`), run 37995597045
      failed before deploying (Docker Hub auth 504 while resolving `docker/dockerfile:1.7`; no image pushed, nothing
      on AWS changed); rearmed to plan (`8c9550f0`). A new arm follows the template PR.
- [ ] Live checks on seanshore.in (CSV import of 20, timed draw of 10 with shuffle taken twice, subjective grading
      issues the certificate, profile and verification page, hide removes it from the public profile, old quizzes,
      attempts and certificates unchanged)
- [ ] Report
