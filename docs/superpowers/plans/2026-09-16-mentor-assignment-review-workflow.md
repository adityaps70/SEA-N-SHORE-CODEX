# Mentor Assignment Review Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give active Sea N Shore mentors a visible learner-assignment review queue and complete review flow that reuses the Phase 2A grading backend, while preserving learner gating, feedback, attempts, and progression semantics.

**Architecture:** Keep migration `0020_learning_assignment_grading.sql` and the existing `learning_assignment_attempts` persistence model unchanged. Reuse `assignmentGradingRepository.grade` as the only grading write primitive, extend its mentor-scoped read model for review detail/history, expose the workflow from Mentor Studio, and render a dedicated review detail screen with explicit Pass / Needs revision intent that must remain consistent with the configured passing score. The learner flow remains driven by `learnerAssignmentRepository.getState`: a passing grade completes progress; a revision grade leaves progress incomplete and permits resubmission while attempts remain.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, PostgreSQL/Aurora via `pg`, Vitest + Testing Library, AWS S3 signed media URLs for conditional attachment display.

**Spec:** User-approved Mentor Assignment Review Workflow in the 2026-09-16 Sea N Shore LMS continuation request.

## Global Constraints

- Repository: `adityaps70/SEA-N-SHORE-CODEX`.
- Work only on `feat/aws-native-phase-0-1`; never touch `main`, merge, create a PR, force-push, or reset.
- Re-fetch the live feature-branch head before every repository write.
- Reuse Phase 2A assignment grading persistence and progression logic; do not create a parallel grading table or migration.
- Follow RED -> GREEN TDD for behavior changes.
- Before deployment, exact-head AWS Infrastructure CI must be 6/6 green and all one-shot migration/deploy/edge guards must read `plan`.
- Use the guarded commit-driven staging deployment workflow and restore any one-shot guard to `plan` immediately after terminal success or failure.
- AWS account must be `310356785722`; never use `992382634586`.

---

### Task 1: Surface pending learner reviews in Mentor Studio

**Files:**
- Test: `src/app/(app)/learn/studio/page.test.tsx`
- Modify: `src/app/(app)/learn/studio/page.tsx`

**Interfaces:**
- Consumes: `assignmentGradingRepository.listForMentor(mentorUserId)`.
- Produces: distinct learner-review count, persistent grading entry point, and pending-review banner without changing the existing course `In review` counter.

- [x] **Step 1: Write the failing behavior test**

The current branch already contains a RED test that seeds one submitted assignment and expects a distinct learner-review entry point and pending banner.

- [x] **Step 2: Verify RED**

Exact-head AWS Infrastructure CI on commit `3c360027413fd647a69d5dc02070b5271cbfe268` reached `Application verify -> Test` and failed while lint/typecheck passed.

- [ ] **Step 3: Implement the minimal Studio behavior**

Import `assignmentGradingRepository`, load mentor-owned attempts alongside courses, derive `pendingLearnerReviews`, render a fourth review metric distinct from course publication review, keep a visible `Review assignments` entry point, and show a banner such as `Review 1 learner submission ->` only when pending attempts exist.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- 'src/app/(app)/learn/studio/page.test.tsx'
```

Expected: Mentor Studio tests pass.

### Task 2: Add mentor-scoped review detail/history read model

**Files:**
- Test: `src/features/learning/assignment-grading-repository.test.ts`
- Modify: `src/features/learning/assignment-grading-repository.ts`

**Interfaces:**
- Consumes: existing mentor ownership joins and `learning_assignment_attempts`, `learning_assignments`, `learning_lessons`, `learning_courses`, `profiles`.
- Produces: `getForMentor(mentorUserId, attemptId)` returning the selected attempt, assignment instructions, conditional `attachmentPath`, and prior attempts for the same learner/enrollment/lesson; returns `null` outside mentor ownership.

- [ ] **Step 1: Write failing repository tests**

Cover mentor-owned detail retrieval, assignment instructions, previous-attempt ordering, and rejection/non-exposure for another mentor's attempt.

- [ ] **Step 2: Run RED**

```bash
npm test -- src/features/learning/assignment-grading-repository.test.ts
```

Expected: tests fail because `getForMentor` does not exist.

- [ ] **Step 3: Implement the smallest mentor-scoped SQL/read mapping**

Use the same active-mentor ownership predicates as `listForMentor`; do not expose learner submissions through a generic unscoped lookup.

- [ ] **Step 4: Run GREEN**

```bash
npm test -- src/features/learning/assignment-grading-repository.test.ts
```

Expected: repository tests pass.

### Task 3: Turn the assignment list into a review queue and add detail page

**Files:**
- Modify: `src/app/(app)/learn/studio/assignments/page.tsx`
- Create: `src/app/(app)/learn/studio/assignments/[attemptId]/page.tsx`
- Add focused route/component tests following the existing App Router test style.

**Interfaces:**
- Consumes: `assignmentGradingRepository.listForMentor`, `assignmentGradingRepository.getForMentor`, `createMediaReadUrl` when `attachmentPath` is present.
- Produces: queue rows/cards showing learner, course, assignment, attempt, submitted time, status, and Review action; detail screen showing course, assignment instructions, learner response, attempt number, previous attempts, feedback/history, and attachment link only when an attachment exists.

- [ ] **Step 1: Write failing queue/detail behavior tests**

Assert the queue includes all approved fields and the detail route renders instructions/current response/history only for the authenticated active mentor.

- [ ] **Step 2: Run RED**

```bash
npm test -- 'src/app/(app)/learn/studio/assignments'
```

Expected: new detail/Review-action expectations fail.

- [ ] **Step 3: Implement queue and detail UI**

Keep `/learn/studio/assignments` as the existing stable grading URL. A `/learn/studio/reviews` alias is optional only if it can be added without duplicating grading logic; the approved requirement says `preferably`, so the existing route is valid and avoids parallel surfaces.

- [ ] **Step 4: Run GREEN**

Run the focused queue/detail tests and confirm all pass.

### Task 4: Add explicit Pass / Needs revision grading intent

**Files:**
- Test: `src/features/learning/assignment-grading-repository.test.ts`
- Modify: `src/features/learning/assignment-grading-repository.ts`
- Modify: `src/features/learning/assignment-grading-actions.ts`
- Modify: `src/features/learning/components/assignment-grading-control.tsx`
- Modify detail page from Task 3 to host the grading control.

**Interfaces:**
- Consumes: configured `max_points` and `passing_percentage`.
- Produces: grading input `{ scorePoints, feedback, decision: 'pass' | 'needs_revision' }`. The repository computes the percentage first and rejects contradictory intent before writing: `pass` requires score >= configured pass threshold; `needs_revision` requires score below it. Successful writes continue to use the existing `graded_by`, `graded_at`, feedback, progress completion, and enrollment finalization logic.

- [ ] **Step 1: Write failing decision tests**

Cover a valid pass, a valid needs-revision grade, a Pass click below threshold, and a Needs revision click at/above threshold.

- [ ] **Step 2: Run RED**

```bash
npm test -- src/features/learning/assignment-grading-repository.test.ts
```

Expected: decision-aware tests fail.

- [ ] **Step 3: Implement decision validation and two explicit controls**

The UI must show score, feedback, `Pass`, and `Needs revision`. Do not permit a contradictory score/outcome to persist.

- [ ] **Step 4: Revalidate all affected routes after grading**

Revalidate Mentor Studio, the grading queue/detail, My Learning, and the learner course route so mentor and learner see the outcome immediately.

- [ ] **Step 5: Run GREEN**

Run repository/action/component-focused tests and confirm pass/revision behavior.

### Task 5: Preserve learner feedback, resubmission, and progression unlock semantics

**Files:**
- Test: `src/features/learning/learner-assignment-repository.test.ts`
- Test/component coverage for `src/features/learning/components/assignment-activity.tsx` if needed.
- Production changes only if tests identify a gap.

**Interfaces:**
- Consumes: existing `LearnerAssignmentState` and attempt history.
- Produces: passed state with mentor feedback and completed material; revision-required state with feedback and enabled resubmission while attempts remain; no gated progression unlock on revision.

- [ ] **Step 1: Add/confirm behavior tests**

Assert a failed graded attempt no longer counts as pending, remains incomplete, and permits the next attempt when `max_attempts` allows it. Assert a passed grade results in completed progress and learner feedback remains visible.

- [ ] **Step 2: Run focused tests**

```bash
npm test -- src/features/learning/learner-assignment-repository.test.ts src/features/learning/assignment-grading-repository.test.ts
```

- [ ] **Step 3: Make only gap-driven changes**

Do not rewrite the learner flow if the existing implementation already satisfies the tests.

### Task 6: Full verification and guarded staging deployment

**Files:**
- No schema migration expected.
- One-shot guard files must remain `plan` except the existing staging deploy guard during the guarded one-shot deployment transaction.

- [ ] **Step 1: Run full application verification**

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

- [ ] **Step 2: Require exact-head AWS Infrastructure CI 6/6 green**

Verify all six jobs for the exact feature-branch head are successful.

- [ ] **Step 3: Re-read safety guards**

Confirm:

```text
scripts/aws/learning-quiz-resilience-migration-action.txt = plan
scripts/aws/staging-deploy-action.txt = plan
scripts/aws/edge-recovery-action.txt = plan
```

- [ ] **Step 4: Run the existing guarded commit-driven staging deployment**

Use only AWS account `310356785722` and the existing GitHub OIDC staging role. Restore the deploy guard to `plan` immediately after terminal success or failure.

- [ ] **Step 5: Runtime verify**

At `https://d3prih0q6jofyr.cloudfront.net`, verify HTTP health, ECS desired/running/pending health, strong runtime error scan, Mentor Studio pending review count/banner, queue/detail rendering, a real mentor grading action, and the corresponding learner passed/unlocked or revision/resubmission state.
