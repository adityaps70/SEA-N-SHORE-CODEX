# Sea N Shore Learning V1 Launch Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish launch-critical LMS review/certificate functionality, apply pending learning migrations safely, deploy the exact certified head to AWS staging, and verify staging.

**Architecture:** Extend existing admin/learner learning repositories and pages. Add one additive certificate migration and a separate exact-head migration runner for 0017+0018. Reuse existing PDF tooling and course completion transaction. Keep deployment through the existing one-shot staging deploy guard.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod, PostgreSQL/Aurora, pdf-lib, Vitest/Testing Library, GitHub Actions OIDC, AWS SSM/RDS Data API/ECS/CloudFront.

**Spec:** `docs/superpowers/specs/2026-09-15-learning-launch-completion-design.md`

## Global Constraints
- Repository `adityaps70/SEA-N-SHORE-CODEX`; branch `feat/aws-native-phase-0-1` only.
- Re-fetch live branch head before every repository write.
- Never touch `main`, merge, create PR, force-push, or reset.
- AWS account must be `310356785722`; never use `992382634586`.
- Staging URL `https://d3prih0q6jofyr.cloudfront.net`.
- One-shot AWS guards return to `plan` immediately after use.
- RED -> GREEN TDD for behavior changes.
- No post-launch proctoring/adaptive/live-class/commerce scope.

---

### Task 1: Administrator curriculum review evidence
**Files:**
- Modify `src/features/learning/admin-course-repository.test.ts`
- Modify `src/features/learning/admin-repository.ts`
- Modify `src/app/(app)/admin/learning/courses/page.test.tsx`
- Modify `src/app/(app)/admin/learning/courses/page.tsx`

**Interfaces:**
- Extend `CourseReviewItem` with ordered `curriculum` sections/lessons.
- Quiz review evidence includes answer correctness only in admin model.

- [ ] Add RED repository/page contracts for authorization, ordering, lesson evidence, quiz pass mark/questions/options/correct option, and empty curriculum.
- [ ] Implement minimal admin read model and compact expandable review UI.
- [ ] Verify focused tests and exact-head CI.

### Task 2: Certificate schema and repository
**Files:**
- Create `infra/aws/database/migrations/0018_learning_certificates.sql`
- Create `src/features/learning/certificate-repository.test.ts`
- Create `src/features/learning/certificate-repository.ts`
- Modify learning schema contract tests.

**Interfaces:**
- `ensureCertificateForEnrollment(learnerId, enrollmentId)` returns immutable certificate evidence or null when not eligible.
- `getCertificateForLearner(learnerId, certificateId)` enforces ownership.
- `getCertificateByVerificationCode(code)` exposes public verification evidence.
- `issueCertificateForCompletedEnrollmentWithQuery(query, enrollmentId)` supports completion transaction reuse.

- [ ] RED tests for eligibility, idempotency, ownership, snapshots, public lookup, and disabled certificates.
- [ ] Add additive create-only migration and schema contract.
- [ ] Implement repository transaction logic and unique issuance.
- [ ] Verify GREEN.

### Task 3: Automatic issuance, PDF download and learner UI
**Files:**
- Modify `src/features/learning/learner-progress-repository.ts` and tests.
- Create `src/features/learning/certificate-pdf.ts` and tests.
- Create `src/app/api/learn/certificates/[certificateId]/route.ts` and tests.
- Create `src/app/(public)/certificates/[verificationCode]/page.tsx` and tests.
- Modify `src/app/(app)/learn/my-learning/page.tsx` and tests.

**Interfaces:**
- Course completion transaction issues certificate when enabled.
- Completed eligible enrollment gets `Download certificate` and `Verify certificate` actions.

- [ ] RED completion/PDF/route/page/UI tests.
- [ ] Implement transaction issuance and idempotent legacy-completion ensure path.
- [ ] Generate server-side PDF with immutable evidence and verification URL.
- [ ] Verify GREEN.

### Task 4: Guarded 0017 + 0018 AWS migration path
**Files:**
- Create `scripts/aws/learning-launch-migration-action.txt` default `plan`.
- Create `scripts/aws/learning-launch-migration.sh`.
- Create `scripts/aws/learning-launch-migration.test.mjs`.
- Create `.github/workflows/aws-learning-launch-migration.yml`.
- Extend `.github/workflows/aws-infra-ci.yml` only if required to enforce the new guard test.

**Interfaces:**
- `plan` performs exact staging shape read only.
- `apply-once` applies 0017 then 0018 in one guarded transaction or verifies already-applied shape.

- [ ] RED guard tests for exact account/repo/head, create-only SQL, expected 0017/0018 shape, plan no-write, stale-head refusal, and `apply-once` only.
- [ ] Implement exact-head OIDC -> SSM -> RDS Data API workflow.
- [ ] Verify CI while action remains `plan`.

### Task 5: Final exact-head certification
- [ ] Re-fetch branch head.
- [ ] Confirm `staging-deploy-action.txt`, edge recovery action, and launch migration action are `plan`.
- [ ] Confirm AWS Infrastructure CI six jobs all green, including lint/typecheck/full test suite/Docker/Terraform/SSM contracts.
- [ ] Fix any discovered defect test-first and re-certify new head.

### Task 6: Apply learning launch migrations
- [ ] Re-fetch exact branch head.
- [ ] Set only `learning-launch-migration-action.txt` to `apply-once`.
- [ ] Wait for exact-head CI and migration workflow success with post-apply schema evidence.
- [ ] Immediately restore migration action to `plan` and certify the restore head.

### Task 7: Deploy exact certified application to staging
- [ ] Re-fetch live head and require green exact-head Infrastructure CI.
- [ ] Set only `scripts/aws/staging-deploy-action.txt` to `deploy-once`.
- [ ] Wait for AWS Staging Deploy to build/push immutable image, create ECS task revision, deploy service, and verify exact image/task.
- [ ] Immediately restore staging deploy action to `plan`.
- [ ] Confirm final branch guard state is safe.

### Task 8: Staging verification
- [ ] Verify `https://d3prih0q6jofyr.cloudfront.net` returns the application.
- [ ] Verify public `/learn` renders without server error.
- [ ] Verify deployment workflow evidence references the expected AWS account, image digest, ECS service/task, and stable service.
- [ ] Report authenticated mentor/admin/learner flows as not directly exercised unless credentials are available; do not fabricate.
