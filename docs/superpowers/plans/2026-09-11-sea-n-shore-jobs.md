# Sea N Shore Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Sea N Shore Jobs into a premium maritime-specific candidate and recruiter experience with explainable matching, structured discovery, Easy Apply, saved/applied tracking, alerts, trust controls, and a recruiter hiring workspace.

**Architecture:** Extend the existing AWS/PostgreSQL Jobs domain additively rather than replacing it. Keep `jobs`, `job_applications`, auth, profiles, maritime passport data, company membership, and the seven-state application lifecycle; add structured maritime job fields and supporting tables, then expose them through focused repository/query/action modules and server-rendered Next.js pages. Matching is deterministic and explainable, using structured profile/job data; PostgreSQL remains the search engine for this release.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, PostgreSQL/Aurora via `pg`, Zod 4, Vitest/Testing Library, Tailwind CSS 4, lucide-react, AWS staging workflows.

**Spec:** Approved Jobs architecture from the 2026-09-11 Sea N Shore Jobs audit/design conversation.

## Global Constraints

- Repository: `adityaps70/SEA-N-SHORE-CODEX`.
- Work only on `feat/aws-native-phase-0-1`.
- Do not touch `main`, merge, or create a PR.
- Preserve the stable social-feed implementation.
- Before deployment, exact-head AWS Infrastructure CI must be green.
- AWS staging deployment must use the existing `scripts/aws/staging-deploy-action.txt` guarded workflow.
- Return both AWS action guards to `plan` after deployment.
- Preserve backward compatibility with free-text `jobs.requirements` and existing application statuses.
- Prefer PostgreSQL-native search/filtering and deterministic explainable matching; no LLM/vector search in this implementation.
- Mobile-first responsive Jobs UI.

---

### Task 1: Characterize and Specify the Jobs Domain

**Files:**
- Create: `src/features/jobs/catalog.test.ts`
- Create: `src/features/jobs/matching.test.ts`
- Create: `src/features/jobs/search.test.ts`
- Create: `scripts/aws/jobs-intelligence-schema.test.mjs`

**Interfaces:**
- Produces: maritime catalog constants, `JobSearchFilters`, `JobCandidateProfile`, `JobMatchResult`, `scoreJobMatch`, and schema contract requirements used by later tasks.

- [ ] **Step 1: Write failing tests** for sea/shore catalogs, filter parsing, explainable match scoring, urgent/recent behavior, salary/joining filters, and additive schema tables/columns.
- [ ] **Step 2: Push test-only commit and verify AWS Infrastructure CI fails for missing production modules/migration.**
- [ ] **Step 3: Do not alter tests after the expected RED failure except to correct genuine test errors.**

### Task 2: Build Structured Jobs Schema and Matching/Search Foundation

**Files:**
- Create: `infra/aws/database/migrations/0010_jobs_intelligence.sql`
- Create: `src/features/jobs/catalog.ts`
- Create: `src/features/jobs/search.ts`
- Create: `src/features/jobs/matching.ts`
- Modify: `src/features/jobs/types.ts`
- Modify: `.github/workflows/aws-infra-ci.yml`

**Interfaces:**
- Produces: structured sea/shore job fields, certificate/visa requirements, saves, alerts, application events, recruiter notes, reports, company verification fields, indexed PostgreSQL search support, filter parsing, and explainable matching.

- [ ] **Step 1: Implement minimal catalog/search/matching code required by Task 1 tests.**
- [ ] **Step 2: Add migration `0010_jobs_intelligence.sql` additively.**
- [ ] **Step 3: Register the migration contract test in AWS Infrastructure CI.**
- [ ] **Step 4: Push and verify exact-head AWS Infrastructure CI is green.**

### Task 3: Upgrade Candidate Repository, Queries, and Actions

**Files:**
- Modify: `src/features/jobs/repository.test.ts`
- Modify: `src/features/jobs/actions.test.ts`
- Create: `src/features/jobs/queries.test.ts`
- Modify: `src/features/jobs/repository.ts`
- Modify: `src/features/jobs/queries.ts`
- Modify: `src/features/jobs/actions.ts`

**Interfaces:**
- Consumes: `JobSearchFilters`, structured job types, match scorer.
- Produces: `searchJobs`, `getJobDetail`, `getSavedJobs`, `getMyJobApplications`, `getJobAlerts`, `saveJob`, `unsaveJob`, `createJobAlert`, `deleteJobAlert`, `reportJob`, application event retrieval, and existing `applyToJob` compatibility.

- [ ] **Step 1: Add failing repository/query/action tests for filters, saves, alerts, reports, and timeline creation.**
- [ ] **Step 2: Push RED test commit and verify expected CI failure.**
- [ ] **Step 3: Implement minimal repository/query/action behavior.**
- [ ] **Step 4: Verify exact-head CI green.**

### Task 4: Build Premium Candidate Jobs Experience

**Files:**
- Modify: `src/app/(app)/jobs/page.tsx`
- Modify: `src/app/(app)/jobs/[id]/page.tsx`
- Create: `src/app/(app)/jobs/saved/page.tsx`
- Create: `src/app/(app)/jobs/applications/page.tsx`
- Create: `src/app/(app)/jobs/alerts/page.tsx`
- Modify: `src/features/jobs/components/job-card.tsx`
- Create: `src/features/jobs/components/jobs-search-form.tsx`
- Create: `src/features/jobs/components/jobs-filter-panel.tsx`
- Create: `src/features/jobs/components/jobs-subnav.tsx`
- Create: `src/features/jobs/components/job-match-panel.tsx`
- Create: `src/features/jobs/components/save-job-button.tsx`
- Create: `src/features/jobs/components/job-alert-button.tsx`
- Create: `src/features/jobs/components/report-job-form.tsx`
- Modify: `src/features/jobs/components/apply-job-button.tsx`
- Modify: `src/features/jobs/components/job-application-list.tsx`
- Create: `src/features/jobs/candidate-ui.test.tsx`

**Interfaces:**
- Produces: mobile-first `/jobs` discovery with For You/Sea/Shore/Urgent/Recent views, structured filters, premium cards, detailed eligibility/match view, saves, applications timeline and alerts.

- [ ] **Step 1: Write candidate UI contract tests first.**
- [ ] **Step 2: Push RED test commit and verify expected CI failure.**
- [ ] **Step 3: Implement discovery/detail/support pages and components.**
- [ ] **Step 4: Verify exact-head CI green.**

### Task 5: Build Company Profiles and Recruiter Hiring Workspace

**Files:**
- Create: `src/features/jobs/hiring-repository.test.ts`
- Create: `src/features/jobs/hiring-actions.test.ts`
- Create: `src/features/jobs/hiring-repository.ts`
- Create: `src/features/jobs/hiring-actions.ts`
- Create: `src/app/(app)/hiring/page.tsx`
- Create: `src/app/(app)/hiring/jobs/page.tsx`
- Create: `src/app/(app)/hiring/jobs/new/page.tsx`
- Create: `src/app/(app)/hiring/jobs/[id]/edit/page.tsx`
- Create: `src/app/(app)/hiring/jobs/[id]/applicants/page.tsx`
- Create: `src/app/(app)/hiring/applicants/[id]/page.tsx`
- Create: `src/app/(app)/companies/[slug]/page.tsx`
- Create: `src/features/jobs/components/job-editor-form.tsx`
- Create: `src/features/jobs/components/applicant-pipeline.tsx`
- Create: `src/features/jobs/components/company-trust-card.tsx`

**Interfaces:**
- Produces: company-member authorization, job create/edit/publish/close, applicant pipeline, status changes with immutable application events, recruiter notes, candidate review and public company trust profile.

- [ ] **Step 1: Write failing authorization and recruiter workflow tests.**
- [ ] **Step 2: Push RED test commit and verify expected CI failure.**
- [ ] **Step 3: Implement recruiter repository/actions/pages with owner/admin/recruiter authorization checks.**
- [ ] **Step 4: Verify exact-head CI green.**

### Task 6: Integrate Navigation, Activity, Trust, and Responsive Polish

**Files:**
- Modify only where necessary: `src/components/navigation/app-header.tsx`, `src/app/(app)/activities/page.tsx`, existing Jobs/activity tests.
- Create/modify focused Jobs tests for accessible navigation, mobile filter controls and stable application links.

**Interfaces:**
- Produces: coherent navigation between Jobs candidate surfaces and Hiring, while preserving global My Activities behavior and social-feed navigation.

- [ ] **Step 1: Add failing integration tests for navigation/accessibility.**
- [ ] **Step 2: Implement minimal navigation/polish changes.**
- [ ] **Step 3: Verify exact-head CI green.**

### Task 7: Migrate, Deploy Once, and Verify Staging

**Files:**
- Add repository-controlled migration workflow/guard only if required by the existing migration pattern for `0010`.
- Temporarily update `scripts/aws/staging-deploy-action.txt` from `plan` to `deploy-once`, then restore to `plan` after a successful run.

**Interfaces:**
- Produces: applied Aurora schema, immutable ECS deployment, CloudFront-visible Jobs release, guards restored to safe state.

- [ ] **Step 1: Confirm branch head and both AWS guards before deployment.**
- [ ] **Step 2: Verify exact-head AWS Infrastructure CI success for the deploy commit.**
- [ ] **Step 3: Apply migration through the repository's existing AWS migration approach.**
- [ ] **Step 4: Set staging deploy action to `deploy-once` exactly once and wait for successful guarded deployment.**
- [ ] **Step 5: Verify CloudFront `/jobs` and relevant authenticated/runtime health surfaces, plus AWS logs.**
- [ ] **Step 6: Restore `scripts/aws/staging-deploy-action.txt` and `scripts/aws/edge-recovery-action.txt` to `plan`.**
- [ ] **Step 7: Verify final remote branch head, guards, CI/deployment results, and no changes to `main`.