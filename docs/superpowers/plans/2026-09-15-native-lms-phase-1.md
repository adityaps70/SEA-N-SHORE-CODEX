# Native Sea N Shore LMS Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native Sea N Shore LMS course player and curriculum material system with Edmingle-style behavior, including native media, prerequisites, completion policies, attempts, drip release, assignments and SCORM 1.2/2004.

**Architecture:** Extend the existing learning schema additively, preserve current course/section/lesson IDs for backwards compatibility, and introduce a material-policy layer that centralizes release, prerequisite, completion and attempt decisions. Mentor Studio remains on existing routes but edits first-class material settings. Learner queries return a safe material projection and the player renders all supported material types in-app. SCORM packages use S3 extraction metadata plus a sandboxed launch/runtime bridge.

**Tech Stack:** Next.js 16, React 19, TypeScript, PostgreSQL/Aurora, AWS S3, GitHub Actions + OIDC + SSM, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-native-lms-phase-1-design.md`

## Global Constraints

- Work only on `feat/aws-native-phase-0-1`; never touch `main`, merge, create a PR, force-push or reset.
- Re-fetch the live branch head before every repository write.
- AWS staging account is `310356785722`; never use `992382634586`.
- All production behavior is implemented RED → GREEN.
- Schema/deploy one-shot guards stay `plan` except for exact-head, CI-gated staging operations and are restored immediately after use.
- Existing published learning behavior remains backwards compatible.

---

### Task 1: RED contracts for Phase 1

**Files:**
- Create: `src/features/learning/lms-material-policy.test.ts`
- Create: `src/features/learning/lms-phase-1-contract.test.ts`

**Interfaces:**
- Produces behavioral contracts for `evaluateMaterialAvailability`, `shouldCompleteMaterial`, `normalizeAttemptLimit`, and schema/UI contracts.

- [ ] Write failing tests for scheduled/drip release, explicit/sequential prerequisite locking, manual/view/media/quiz/assignment/SCORM completion, attempt limits and locked-content redaction expectations.
- [ ] Write failing contract assertions requiring migration `0019_learning_lms_phase_1.sql`, SCORM runtime components, native player material renderers, and Mentor Studio material controls.
- [ ] Push only the RED tests and capture an exact-head CI failure caused by the missing production implementation.

### Task 2: Additive LMS schema

**Files:**
- Create: `infra/aws/database/migrations/0019_learning_lms_phase_1.sql`
- Create: `scripts/aws/learning-lms-phase-1-migration-action.txt`
- Create: `scripts/aws/learning-lms-phase-1-migration.sh`
- Create: `.github/workflows/aws-learning-lms-phase-1-migration.yml`
- Create: `scripts/aws/learning-lms-phase-1-migration.test.mjs`

**Interfaces:**
- Adds course `navigation_mode`, material release/prerequisite/completion/attempt fields, progress projections, SCORM package/attempt tables, and assignment definition/attempt tables.
- Migration workflow accepts only `plan` or `migrate-once` and requires exact-head Infrastructure CI before staging migration.

- [ ] Extend the RED schema contract to assert all new columns, checks, FKs and tables.
- [ ] Implement idempotent SQL with backwards-compatible defaults.
- [ ] Implement commit-driven migration guard/workflow following existing learning-launch migration patterns and hard-assert account `310356785722`.
- [ ] Keep migration action in `plan` during code development.

### Task 3: Material policy and learner repository

**Files:**
- Create: `src/features/learning/lms-material-policy.ts`
- Modify: `src/features/learning/learner-course-repository.ts`
- Modify: `src/features/learning/learner-progress-repository.ts`
- Modify: `src/features/learning/learner-progress-repository.test.ts`

**Interfaces:**
- `evaluateMaterialAvailability(input): { available: boolean; reason: 'unpublished' | 'scheduled' | 'drip' | 'prerequisite' | null }`
- `shouldCompleteMaterial(input): boolean`
- `normalizeAttemptLimit(value): number | null`
- learner repository returns `isAvailable`, `lockReason`, release/completion settings, attempts and content fields only when safe.

- [ ] Verify policy tests fail.
- [ ] Implement pure policy functions.
- [ ] Extend learner query/projection with material controls and prerequisite progress.
- [ ] Redact media/body/external URL for unavailable materials.
- [ ] Enforce availability in complete/progress writes.
- [ ] Make media progress calculate percentage and auto-complete at the configured threshold.
- [ ] Re-run focused repository/policy tests to GREEN.

### Task 4: Attempt enforcement, assignments and SCORM domain

**Files:**
- Modify: `src/features/learning/learner-quiz-repository.ts`
- Modify: `src/features/learning/learner-quiz-repository.test.ts`
- Create: `src/features/learning/learner-assignment-repository.ts`
- Create: `src/features/learning/learner-assignment-repository.test.ts`
- Create: `src/features/learning/scorm-runtime.ts`
- Create: `src/features/learning/scorm-runtime.test.ts`
- Create: `src/features/learning/scorm-repository.ts`
- Create: `src/features/learning/scorm-repository.test.ts`

**Interfaces:**
- Quiz submission refuses when material `max_attempts` is exhausted.
- Assignment repository returns current attempt availability and creates one immutable submission attempt.
- SCORM runtime normalizes 1.2/2004 values into completion/success/score/location/suspend/time state.
- SCORM repository starts/commits/finishes attempts scoped to learner+enrollment+material.

- [ ] Add failing quiz max-attempt test.
- [ ] Add failing assignment attempt/completion tests.
- [ ] Add failing SCORM 1.2/2004 normalization and completion tests.
- [ ] Implement minimal domain/repositories to pass.

### Task 5: Mentor Studio material builder

**Files:**
- Modify: `src/features/learning/mentor-curriculum-repository.ts`
- Modify: `src/features/learning/mentor-curriculum-actions.ts`
- Modify: `src/features/learning/components/mentor-curriculum-editor.tsx`
- Modify: `src/features/learning/components/learning-media-upload-field.tsx`
- Add/modify corresponding tests.

**Interfaces:**
- Material draft supports `image`, `external_embed`, `scorm`, publication/release/prerequisite/completion/max-attempt fields.
- SCORM upload uses an allowed `lesson_scorm` S3 authoring kind.

- [ ] Add failing UI/repository tests for Add Material, material settings and SCORM ZIP upload.
- [ ] Extend repository validation and writes.
- [ ] Replace learner-facing “lesson type” authoring copy with material-oriented controls while keeping route compatibility.
- [ ] Add release/prerequisite/completion/attempt controls and material-specific fields.
- [ ] Require a ready SCORM package before a published SCORM material can be submitted for review.
- [ ] Run focused tests to GREEN.

### Task 6: Native learner material player

**Files:**
- Create: `src/features/learning/components/material-player.tsx`
- Create: `src/features/learning/components/material-player.test.tsx`
- Create: `src/features/learning/components/scorm-player.tsx`
- Modify: `src/features/learning/components/resumable-lesson-media.tsx`
- Modify: `src/app/(app)/learn/courses/[slug]/learn/page.tsx`
- Modify: `src/app/(app)/learn/courses/[slug]/learn/page.test.tsx`

**Interfaces:**
- `MaterialPlayer` renders native video/audio/image/PDF/document/text/embed/download/quiz/assignment/SCORM experiences.
- Locked material renders metadata/lock reason only.
- Curriculum sidebar shows availability, completion, attempts and release state.

- [ ] Add failing player tests proving ordinary videos/images/PDFs/embeds/SCORM no longer render as generic external “Open lesson” links.
- [ ] Implement native renderer and premium two-pane LMS shell.
- [ ] Preserve quiz and completion components, replacing manual completion where completion policy is automatic.
- [ ] Run player tests to GREEN.

### Task 7: SCORM package launch/runtime transport

**Files:**
- Create: `src/app/api/learning/scorm/[lessonId]/launch/route.ts`
- Create: `src/app/api/learning/scorm/[lessonId]/runtime/route.ts`
- Create: route tests.
- Extend S3/media policy files as required.

**Interfaces:**
- Launch endpoint authorizes enrollment/material availability then serves or redirects to a sandbox-safe extracted launch asset.
- Runtime endpoint accepts authenticated SCORM state mutations for the current attempt only.

- [ ] Add failing authorization/runtime tests.
- [ ] Implement endpoint authorization and SCORM adapter persistence.
- [ ] Ensure no raw bucket credentials or unrestricted S3 URLs are exposed.
- [ ] Run focused tests to GREEN.

### Task 8: Full verification, staging migration and deployment

**Files:**
- Modify deployment/migration guards only for one-shot operations; final state must be `plan`.

- [ ] Run exact-head AWS Infrastructure CI after all code is green.
- [ ] Arm LMS migration `migrate-once`, only after exact-head six-job CI success.
- [ ] Verify migration through GitHub OIDC → account `310356785722` → bootstrap/SSM and capture schema evidence.
- [ ] Immediately restore migration guard to `plan` and get exact-head CI green again.
- [ ] Arm normal staging deploy guard on an exact CI-green commit.
- [ ] Deploy exact commit to `https://d3prih0q6jofyr.cloudfront.net`.
- [ ] Verify ECS task/image, runtime shape and HTTP health.
- [ ] Immediately restore deploy guard to `plan`.
- [ ] Run final exact-head six-job CI and AWS remote verification before any completion claim.
