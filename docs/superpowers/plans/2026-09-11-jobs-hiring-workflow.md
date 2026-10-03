# Sea N Shore Jobs Hiring Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a secure recruiter Hiring workspace for managing maritime vacancies and applicants on the existing Jobs Intelligence foundation.

**Architecture:** Extend the existing `hiring-repository` as the single company-scoped recruiter data boundary, reuse deterministic `scoreJobMatch` for applicant ranking, expose narrow authenticated server actions, and build server-rendered `/hiring` routes with small client mutation controls. Preserve the existing candidate Jobs repository, statuses, schema foundation, app shell and AWS deployment guards.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Zod, PostgreSQL/Aurora, Vitest, existing AWS auth/database helpers.

**Spec:** `docs/superpowers/specs/2026-09-11-jobs-hiring-workflow.md`

## Global Constraints

- Repository: `adityaps70/SEA-N-SHORE-CODEX`.
- Work only on branch `feat/aws-native-phase-0-1`.
- Do not touch `main`, merge, or create a PR.
- Preserve the stable social-feed implementation.
- `scripts/aws/staging-deploy-action.txt` and `scripts/aws/edge-recovery-action.txt` remain `plan` except during an explicitly guarded staging deployment and must be restored to `plan` afterward.
- Hiring authorization requires an approved company membership with role `owner`, `administrator`, or `recruiter`.
- Use test-first RED → GREEN cycles and verify exact branch head before deployment.

---

### Task 1: Recruiter repository expansion

**Files:**
- Modify: `src/features/jobs/hiring-repository.test.ts`
- Modify: `src/features/jobs/hiring-repository.ts`
- Reuse: `src/features/jobs/matching.ts`
- Reuse: `src/features/jobs/types.ts`

**Interfaces:**
- Consumes: `HIRING_ROLES`, `HiringJobInput`, `JobApplicationStatus`, `scoreJobMatch`.
- Produces: `listCompanyJobs(userId, companyId)`, `getEditableJob(userId, companyId, jobId)`, `updateJob(userId, jobId, input)`, `listApplicants(userId, jobId, status?)`, `getApplicationReview(userId, applicationId)`.

- [ ] **Step 1: Add failing repository tests**

Add tests that prove: recruiter notes use the actual `recruiter_id` schema column; company vacancy reads are membership- and company-scoped; editing cannot move a job to a client-supplied company; applicant queries are scoped through the job's company; applicant rows expose candidate maritime data needed for matching; application review loads history and recruiter notes only after authorization.

- [ ] **Step 2: Run CI and verify RED**

Expected failure: missing repository methods and the recruiter-note column assertion fails against the existing implementation.

- [ ] **Step 3: Implement minimal repository behavior**

Use server-controlled company identity and transaction-local authorization. Replace structured certificate/visa requirements atomically on edit. Map applicant candidate data into `JobCandidateProfile`, map the vacancy into `JobListing`, and call `scoreJobMatch` in application code rather than duplicating scoring SQL.

- [ ] **Step 4: Run exact-head CI and verify GREEN**

Expected: lint, typecheck, repository tests and existing regression suite pass.

- [ ] **Step 5: Commit**

Commit repository behavior separately from UI.

### Task 2: Hiring server actions

**Files:**
- Create: `src/features/jobs/hiring-actions.test.ts`
- Create: `src/features/jobs/hiring-actions.ts`

**Interfaces:**
- Consumes: `requireAwsUser`, `hiringRepository`, `HiringJobInput`, `JOB_APPLICATION_STATUSES`.
- Produces: `createHiringJob`, `updateHiringJob`, `updateHiringApplicationStatus`, `saveHiringRecruiterNote`.

- [ ] **Step 1: Add failing action tests**

Assert Zod validation rejects invalid UUIDs/statuses and malformed salary/joining input, server user identity is always used, repository errors become safe user-facing results, and successful writes revalidate `/hiring`, relevant vacancy/applicant routes, and candidate application views after status changes.

- [ ] **Step 2: Run CI and verify RED**

Expected failure: `hiring-actions.ts` does not exist.

- [ ] **Step 3: Implement minimal authenticated actions**

Parse structured form payloads with Zod, call `requireAwsUser`, invoke repository methods, return `{ ok: true } | { ok: false; error: string }`, and revalidate only affected paths.

- [ ] **Step 4: Run exact-head CI and verify GREEN**

Expected: new action tests plus all existing tests pass.

- [ ] **Step 5: Commit**

Commit action layer independently.

### Task 3: Hiring dashboard and vacancy management UI

**Files:**
- Create: `src/jobs-hiring-experience-contract.test.tsx`
- Create: `src/features/jobs/components/hiring-subnav.tsx`
- Create: `src/features/jobs/components/hiring-job-form.tsx`
- Create: `src/app/(app)/hiring/page.tsx`
- Create: `src/app/(app)/hiring/jobs/page.tsx`
- Create: `src/app/(app)/hiring/jobs/new/page.tsx`
- Create: `src/app/(app)/hiring/jobs/[jobId]/edit/page.tsx`

**Interfaces:**
- Consumes: Hiring repository reads and Task 2 actions.
- Produces: recruiter dashboard, vacancy list, structured new/edit vacancy workflows.

- [ ] **Step 1: Add failing source/behavior contracts**

Require the dashboard funnel labels `Active Jobs`, `Applicants`, `Shortlisted`, `Interviews`; vacancy list links to applicants and editing; composer fields for sea/shore domain, rank, vessel type, experience, joining, salary, regions, certificates, visas, urgent and Easy Apply; and responsive Hiring navigation.

- [ ] **Step 2: Run CI and verify RED**

Expected failure: `/hiring` routes/components are absent.

- [ ] **Step 3: Implement premium Hiring pages**

Resolve the authorized company server-side. Show a helpful no-company state if the user lacks hiring access. Reuse one structured form component for create/edit and retain Sea N Shore Jobs visual language.

- [ ] **Step 4: Run exact-head CI and verify GREEN**

Expected: source contracts and full regression suite pass.

- [ ] **Step 5: Commit**

Commit dashboard/vacancy UI independently.

### Task 4: Applicant pipeline and candidate review UI

**Files:**
- Extend: `src/jobs-hiring-experience-contract.test.tsx`
- Create: `src/features/jobs/components/hiring-status-action.tsx`
- Create: `src/features/jobs/components/recruiter-note-form.tsx`
- Create: `src/app/(app)/hiring/jobs/[jobId]/applicants/page.tsx`
- Create: `src/app/(app)/hiring/applicants/[applicationId]/page.tsx`

**Interfaces:**
- Consumes: `listApplicants`, `getApplicationReview`, status/note actions, `JOB_APPLICATION_STATUS_LABELS`.
- Produces: applicant funnel, deterministic match cards, candidate review, immutable timeline presentation and private note controls.

- [ ] **Step 1: Add failing UI contracts**

Require `Match` percentages, rank/vessel/availability context, pipeline status filters, `Shortlist`, `Interview`, `Select`, `Reject`, `Application timeline`, `Private recruiter notes`, and missing requirement explanations.

- [ ] **Step 2: Run CI and verify RED**

Expected failure: applicant routes/components are absent.

- [ ] **Step 3: Implement pipeline and review screens**

Render deterministic match reasons/warnings from the repository; keep recruiter notes visibly private; use compact mutation controls that call server actions and preserve the existing status vocabulary.

- [ ] **Step 4: Run exact-head CI and verify GREEN**

Expected: all Hiring/candidate/social tests pass together.

- [ ] **Step 5: Commit**

Commit applicant workflow independently.

### Task 5: Company trust page and final verification

**Files:**
- Extend: `src/jobs-hiring-experience-contract.test.tsx`
- Create: `src/app/(app)/hiring/company/page.tsx`
- Potentially modify: `src/features/jobs/components/hiring-subnav.tsx`

**Interfaces:**
- Consumes: authorized company metadata.
- Produces: company trust/verification summary linked from Hiring navigation.

- [ ] **Step 1: Add failing company-page contract**

Require company name, verification status, current hiring role, and link back to public company Jobs where available.

- [ ] **Step 2: Run CI and verify RED**

Expected failure: company Hiring page absent.

- [ ] **Step 3: Implement trust page**

Show platform-controlled verification state without allowing self-verification.

- [ ] **Step 4: Run full exact-head CI**

Require successful lint, typecheck, all Vitest suites, Docker build, Terraform validation, schema/security contracts and guard tests.

- [ ] **Step 5: Verify guards and deployment readiness**

Confirm both AWS guard files are `plan`. Do not deploy until the complete Jobs/Hiring slice is green. During later guarded staging deployment, use the existing workflow only, verify live candidate and Hiring pages, and restore both guards to `plan`.
