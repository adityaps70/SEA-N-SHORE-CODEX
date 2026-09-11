# Sea N Shore Organization Hiring Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Hiring an organization-only capability with a platform Admin approval center, connected organization onboarding, company/recruiter access requests, and server-enforced verified-employer authorization.

**Architecture:** Add a focused `organizations` domain alongside the existing Jobs/Hiring domain. Persist organization verification and company-access requests in Aurora, use `public.user_roles` for platform-administrator authorization, use transaction-local checks for every approval mutation, and expose a context-aware `/hiring` experience. The existing Hiring repository remains the employer data boundary but is tightened to require `companies.is_verified = true` in addition to approved owner/administrator/recruiter membership.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, Zod, PostgreSQL/Aurora, Vitest, GitHub Actions, AWS OIDC/SSM/RDS Data API, existing Cognito auth and AWS deployment guards.

**Spec:** `docs/superpowers/specs/2026-09-11-organization-hiring-approval-design.md`

## Global Constraints

- Repository: `adityaps70/SEA-N-SHORE-CODEX`.
- Work only on branch `feat/aws-native-phase-0-1`.
- Do not touch `main`, merge, or create a PR.
- Correct AWS account is `310356785722`; never use `992382634586`.
- Preserve existing Jobs candidate flows, application statuses, social features, and the stable AWS runtime.
- `scripts/aws/staging-deploy-action.txt` remains `plan` except during one deliberate exact-head staging deployment, then is restored immediately.
- `scripts/aws/edge-recovery-action.txt` remains `plan` throughout unless a real edge-recovery incident occurs.
- Existing `scripts/aws/jobs-intelligence-migration-action.txt` stays `plan`; migration 0011 gets its own guarded action file.
- Use RED -> observed CI failure -> GREEN for implementation slices.
- Never grant organization, recruiter, Hiring, or admin permissions from a client-side flag or self-declared profile type.
- Platform administrator checks must use `public.user_roles(role = 'administrator')`.
- Hiring requires both verified company and approved hiring-capable membership.

---

## Task 1: Add the organization-approval schema and guarded 0011 migration

**Files:**
- Create: `infra/aws/database/migrations/0011_organization_hiring_approval.sql`
- Create: `scripts/aws/organization-hiring-approval-schema.test.mjs`
- Create: `scripts/aws/organization-hiring-approval-migration.test.mjs`
- Create: `scripts/aws/organization-hiring-approval-migration-action.txt`
- Create: `scripts/aws/organization-hiring-approval-migration.sh`
- Create: `.github/workflows/aws-organization-hiring-approval-migration.yml`
- Modify: `.github/workflows/aws-infra-ci.yml`

**Interfaces:**
- Produces `public.organization_applications`.
- Produces `public.company_access_requests`.
- Keeps `public.companies.is_verified` as the canonical Hiring security flag.
- Preserves already-approved legacy Hiring companies via a narrowly approved compatibility backfill.

- [ ] **Step 1: Write failing schema and migration guard contracts**

Create Node contract tests that require:

```text
organization_applications
company_access_requests
organization_applications_admin_queue_idx
organization_applications_submitter_idx
company_access_requests_admin_queue_idx
company_access_requests_company_queue_idx
company_access_requests_user_idx
```

Require application statuses `pending`, `changes_requested`, `approved`, `rejected`, `suspended`; access statuses `pending`, `approved`, `rejected`, `cancelled`; and request types `join_company`, `recruiter_access`.

The migration-guard test must require:
- default action `plan`;
- accepted actions only `plan|apply-once`;
- exact branch SHA enforcement;
- expected account `310356785722`;
- no old account number;
- transaction begin/rollback/commit;
- read-only shape detection before apply;
- exact-head AWS Infrastructure CI gate;
- OIDC credentials;
- plan-only evidence and applied evidence.

Register both tests in `.github/workflows/aws-infra-ci.yml`.

- [ ] **Step 2: Commit tests only and observe RED exact-head CI**

Expected failure: migration file/runner/workflow/action file are absent.

Suggested commit: `test: define organization approval migration contract`.

- [ ] **Step 3: Implement additive migration 0011**

The schema should be additive and use text + CHECK constraints unless introducing enums is clearly necessary. A representative shape:

```sql
create table if not exists public.organization_applications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  submitted_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending',
  official_email text not null,
  registration_reference text,
  applicant_role text not null,
  supporting_notes text,
  admin_review_note text,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  constraint organization_applications_status_check
    check (status in ('pending','changes_requested','approved','rejected','suspended'))
);
```

```sql
create table if not exists public.company_access_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_type text not null,
  requested_role public.company_member_role not null,
  message text,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  reviewer_note text,
  constraint company_access_requests_type_check
    check (request_type in ('join_company','recruiter_access')),
  constraint company_access_requests_status_check
    check (status in ('pending','approved','rejected','cancelled'))
);
```

Prevent duplicate pending access requests with a partial unique index over company/user/requested-role/request-type where status is pending.

Add a controlled legacy compatibility backfill:

```sql
update public.companies c
set is_verified = true,
    verified_at = coalesce(c.verified_at, now())
where c.is_verified = false
  and exists (
    select 1
    from public.company_members cm
    where cm.company_id = c.id
      and cm.approved_at is not null
      and cm.role::text in ('owner','administrator','recruiter')
  );
```

This backfill exists solely so adding the new `is_verified` authorization requirement does not revoke an already-approved employer. Do not create organization applications for these legacy companies and do not auto-approve future organizations.

- [ ] **Step 4: Implement dedicated guarded migration runner/workflow**

Mirror the established `jobs-intelligence` migration discipline, but scope it strictly to 0011. Allow only the exact create/index statements and the one approved compatibility UPDATE. Reject `DROP`, `TRUNCATE`, arbitrary `DELETE`, extra UPDATEs, or unexpected statement order/scope.

The live-shape proof should count the two new tables, required indexes, required constraints/columns, and confirm there are no legacy approved-hiring companies left unverified.

- [ ] **Step 5: Run exact-head CI and verify GREEN**

Require:

```bash
node --test scripts/aws/organization-hiring-approval-schema.test.mjs
node --test scripts/aws/organization-hiring-approval-migration.test.mjs
```

plus full AWS Infrastructure CI.

- [ ] **Step 6: Commit implementation**

Suggested commit: `feat: add guarded organization approval migration`.

Do not apply the migration yet; keep the new action guard at `plan` until all application code is tested.

---

## Task 2: Build the organization domain repository and authorization layer

**Files:**
- Create: `src/features/organizations/types.ts`
- Create: `src/features/organizations/schemas.ts`
- Create: `src/features/organizations/organization-repository.ts`
- Create: `src/features/organizations/organization-repository.test.ts`
- Create: `src/features/organizations/admin-queries.ts`

**Interfaces:**
- Produces application/access-request types and status constants.
- Produces `getHiringAccessState(userId)`.
- Produces transactional organization application creation/resubmission.
- Produces platform-admin metrics/queues/reviews.
- Produces company owner/admin team-access review.

- [ ] **Step 1: Write repository RED tests**

Test all of the following before implementation:

1. `isPlatformAdministrator(userId)` reads only `public.user_roles` and requires role `administrator`.
2. `createOrganizationApplication` transaction creates:
   - a company with `is_verified = false`;
   - founding `company_members` row role `owner` with `approved_at = null`;
   - `organization_applications` row status `pending`.
3. The company ID/name/slug are server-controlled through the transaction result, not accepted as authorization proof later.
4. Duplicate organization/application collisions fail safely.
5. `getHiringAccessState` returns one of approved organization, organization application, access request, or none.
6. `createCompanyAccessRequest` requires an existing company and maps:
   - `join_company` -> `member`;
   - `recruiter_access` -> `recruiter`.
7. A requester cannot self-approve.
8. Platform admin organization approval atomically:
   - sets application `approved`;
   - sets `companies.is_verified = true`, `verified_at`, `verified_by`;
   - approves the founding owner membership;
   - writes `audit_events`.
9. `changes_requested` and `rejected` write review state/note but do not verify company.
10. `suspended` sets `companies.is_verified = false` and writes audit event.
11. Organization owner/admin can approve an access request only for their own verified company.
12. Company recruiters/members cannot approve access requests.
13. Platform admin can approve/reject any access request and every decision is audited.
14. Access approval upserts/updates the target membership role and `approved_at` in the same transaction.

Suggested command:

```bash
npm test -- src/features/organizations/organization-repository.test.ts
```

- [ ] **Step 2: Commit RED tests and observe intended CI failure**

Expected failure: organization repository/types/schemas/admin queries do not exist.

- [ ] **Step 3: Implement domain constants and schemas**

Use explicit constants such as:

```ts
export const ORGANIZATION_APPLICATION_STATUSES = [
  'pending', 'changes_requested', 'approved', 'rejected', 'suspended',
] as const

export const COMPANY_ACCESS_REQUEST_TYPES = [
  'join_company', 'recruiter_access',
] as const
```

Zod organization input should validate normalized slug, company name/type, website, official email, office location, description, fleet summary, vessel types, applicant role, optional registration/reference number, and supporting notes.

- [ ] **Step 4: Implement repository with transaction-local authorization**

Keep every security-sensitive mutation inside one transaction and re-query authorization from Aurora in that transaction. Never rely on a page-level earlier authorization result.

Recommended public methods:

```ts
isPlatformAdministrator(userId)
getAdminMetrics(userId)
getHiringAccessState(userId)
createOrganizationApplication(userId, input)
updateAndResubmitOrganizationApplication(userId, applicationId, input)
listVerifiedCompanies(search?)
createCompanyAccessRequest(userId, input)
listOrganizationApplicationsForAdmin(userId, status?)
getOrganizationApplicationForAdmin(userId, applicationId)
reviewOrganizationApplication(userId, applicationId, decision, note)
listAccessRequestsForAdmin(userId, status?)
reviewAccessRequestAsAdmin(userId, requestId, decision, note)
listCompanyAccessRequests(userId, companyId, status?)
reviewCompanyAccessRequest(userId, requestId, decision, note)
```

`admin-queries.ts` may wrap authenticated page access, for example by using `requireAwsUser()` plus repository admin check and `notFound()` for non-admin page requests. Admin mutation functions must still re-check in repository transactions.

- [ ] **Step 5: Run exact-head CI and verify GREEN**

Require repository tests, lint, typecheck and full existing regressions green.

- [ ] **Step 6: Commit repository layer**

Suggested commit: `feat: add organization approval domain repository`.

---

## Task 3: Add organization actions and connect Organisation onboarding

**Files:**
- Create: `src/features/organizations/organization-actions.ts`
- Create: `src/features/organizations/organization-actions.test.ts`
- Modify: `src/features/profiles/actions.ts`
- Modify: `src/features/profiles/actions-company.test.ts`
- Extend if useful: `src/features/profiles/onboarding-activation-service.test.ts`

**Interfaces:**
- Produces authenticated mutation actions for applications and access requests.
- Changes organization onboarding success route to `/hiring/company/setup`.
- Leaves professional onboarding success route at `/home`.

- [ ] **Step 1: Write RED action/onboarding tests**

Require:
- invalid form input rejected before auth/repository write;
- authenticated user ID always supplied by `requireAwsUser`;
- safe errors for duplicate/pending application conflicts;
- create organization application redirects/revalidates `/hiring` and setup state;
- resubmission only works for submitter and permitted statuses;
- join/recruiter request actions never accept arbitrary requested role;
- `identityRoot = organisation` activation redirects to `/hiring/company/setup`;
- professional activation remains `/home`;
- legacy `profileType = company` onboarding, if still reachable, also routes into organization setup.

Suggested commands:

```bash
npm test -- src/features/organizations/organization-actions.test.ts
npm test -- src/features/profiles/actions-company.test.ts
```

- [ ] **Step 2: Commit RED tests and observe expected failure**

- [ ] **Step 3: Implement actions**

Use the existing pattern from `hiring-actions.ts`: Zod parse first, `requireAwsUser`, repository mutation, safe result, targeted `revalidatePath`.

Do not put approval authority into actions; repository methods remain the security boundary.

- [ ] **Step 4: Implement onboarding redirect**

In `completeActivation`, after successful save:

```ts
redirect(parsed.data.identityRoot === 'organisation' ? '/hiring/company/setup' : '/home')
```

For the legacy `completeOnboarding`, route `profileType === 'company'` to organization setup.

- [ ] **Step 5: Exact-head CI GREEN and commit**

Suggested commit: `feat: connect organization onboarding to approval flow`.

---

## Task 4: Build the Hiring onboarding/state experience and company team approvals

**Files:**
- Create: `src/organization-hiring-approval-experience-contract.test.tsx`
- Create: `src/features/organizations/components/organization-application-form.tsx`
- Create: `src/features/organizations/components/company-access-request-form.tsx`
- Create: `src/features/organizations/components/organization-status-card.tsx`
- Create: `src/features/organizations/components/company-access-review-actions.tsx`
- Create: `src/app/(app)/hiring/company/setup/page.tsx`
- Create: `src/app/(app)/hiring/company/join/page.tsx`
- Create: `src/app/(app)/hiring/company/recruiter-access/page.tsx`
- Create: `src/app/(app)/hiring/company/team/page.tsx`
- Modify: `src/app/(app)/hiring/page.tsx`
- Modify: `src/features/jobs/components/hiring-subnav.tsx`

**Interfaces:**
- `/hiring` becomes state-aware.
- Organization setup creates/submits application.
- Join/recruiter flows create access requests.
- Approved owner/admin can review their own company team requests.

- [ ] **Step 1: Write UI/source RED contracts**

Require the no-relationship state to contain exactly the user-requested product entry points:

```text
Start Hiring on Sea N Shore
Post maritime vacancies, find matching seafarers and manage applicants.
Create Company Profile
Join Existing Company
Request Recruiter Access
Already approved? Your Hiring workspace will appear automatically.
```

Require pending state language such as `Verification in progress`, changes-requested state with the admin note and `Update application`/`Resubmit`, approved state using the existing dashboard, and rejected/suspended states with no Post Job action.

Require setup/join/recruiter/team routes and forms to exist.

Suggested command:

```bash
npm test -- src/organization-hiring-approval-experience-contract.test.tsx
```

- [ ] **Step 2: Commit RED UI contracts and observe failure**

- [ ] **Step 3: Implement `/hiring` state machine**

Resolution order:
1. ask existing Hiring repository for verified approved Hiring company;
2. if present, show current dashboard;
3. otherwise load organization Hiring access state;
4. render pending/changes/rejected/suspended/access-request/no-relationship experience.

Do not expose `Post a job` unless verified employer authorization succeeds.

- [ ] **Step 4: Implement organization setup**

`/hiring/company/setup` pre-fills data available from organization onboarding where possible, but collects the verification fields missing from generic account onboarding. Submission shows a clear success/pending state rather than returning users to a dead end.

- [ ] **Step 5: Implement join and recruiter-access flows**

Use a verified-company chooser/search. The user selects the company; the server determines requested role from the route/action type. Show current pending/result state after submission.

- [ ] **Step 6: Implement company team request page**

`/hiring/company/team` lists pending/recent requests. Only approved owner/administrator can approve/reject; recruiter/member cannot mutate even if they directly load the route.

Add Team to Hiring subnav in a way that does not weaken authorization.

- [ ] **Step 7: Run exact-head CI GREEN and commit**

Suggested commit: `feat: add organization hiring onboarding experience`.

---

## Task 5: Build the platform Admin approval center and pending-work navigation

**Files:**
- Create: `src/features/organizations/components/admin-organization-review-actions.tsx`
- Create: `src/features/organizations/components/admin-access-review-actions.tsx`
- Create: `src/app/(app)/admin/page.tsx`
- Create: `src/app/(app)/admin/organizations/page.tsx`
- Create: `src/app/(app)/admin/organizations/[applicationId]/page.tsx`
- Create: `src/app/(app)/admin/access-requests/page.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/components/navigation/app-header.tsx`
- Modify: `src/components/navigation/mobile-app-header.tsx`
- Add/extend tests for admin access and navigation chrome.

**Interfaces:**
- Admin pages are server-gated by `public.user_roles` administrator role.
- Admin dashboard shows approval workload.
- Header/mobile header expose Admin only for authorized platform admins, with pending-count badge.

- [ ] **Step 1: Extend RED contracts for admin experience**

Require routes and labels:

```text
Pending Organizations
Changes Requested
Approved Organizations
Suspended Organizations
Pending Access Requests
Approve
Request Changes
Reject
Suspend
```

Require admin pages to call the server admin gate, not read profile type.

Require navigation to render an `/admin` entry and pending badge only when the layout-provided admin state says the user is a platform administrator.

- [ ] **Step 2: Commit RED contracts and observe failure**

- [ ] **Step 3: Implement admin chrome query**

From app layout, after resolving the authenticated user, obtain a compact admin-chrome result such as:

```ts
{ isAdministrator: boolean; pendingCount: number }
```

For non-admins return false/0 without throwing. For admin pages use a strict `requirePlatformAdministrator()` gate.

- [ ] **Step 4: Implement `/admin` dashboard**

Show queue metrics and direct links to pending organizations and access requests. Admin receives applications through this persisted queue immediately after submission; email is not required for correctness.

- [ ] **Step 5: Implement organization queues/review screen**

List oldest pending work first. Full review screen shows company/application data, applicant identity, verification details, current status, and review note. Mutation buttons call server actions that re-check administrator authorization transactionally.

- [ ] **Step 6: Implement access-request queue**

Admin can approve/reject pending join/recruiter requests with note. Show company, requester, requested role/type and timestamps.

- [ ] **Step 7: Add visible pending-work badge**

Desktop `AppHeader`: compact Admin shield link with count badge near account actions.

Mobile `MobileAppHeader`: Admin icon/count in header actions rather than expanding the already-dense 8-item bottom nav.

- [ ] **Step 8: Run exact-head CI GREEN and commit**

Suggested commit: `feat: add organization approval admin center`.

---

## Task 6: Enforce verified-organization authorization across all existing Hiring operations

**Files:**
- Modify: `src/features/jobs/hiring-repository.test.ts`
- Modify: `src/features/jobs/hiring-repository.ts`
- Potentially extend: `src/features/jobs/hiring-actions.test.ts`
- Re-run: `src/jobs-hiring-experience-contract.test.tsx`

**Interfaces:**
- Every employer-management read/write requires verified company plus approved Hiring role.
- Suspension immediately invalidates Hiring authorization without waiting for a session/profile change.

- [ ] **Step 1: Add RED authorization assertions**

Tests must assert `c.is_verified = true` (or equivalent verified-company CTE) exists in:
- `getAuthorizedCompany`;
- dashboard metrics;
- company job list;
- editable job read;
- create job transaction authorization;
- update job authorization;
- applicant list;
- application review;
- application status update;
- recruiter-note save.

Also add a behavior test showing an unverified company row cannot map to an authorized Hiring company even if membership is approved.

Suggested command:

```bash
npm test -- src/features/jobs/hiring-repository.test.ts
```

- [ ] **Step 2: Commit RED tests and observe failure**

- [ ] **Step 3: Tighten repository SQL**

The base authorized company select should include:

```sql
and c.is_verified = true
```

Every other authorization query/CTE must either join `public.companies c` and require `c.is_verified = true`, or call a transaction-local verified-company authorization helper. Avoid checking only the earlier page-level company object.

- [ ] **Step 4: Verify suspension semantics**

Because suspension flips `companies.is_verified` false, all Hiring reads/writes should fail closed immediately. Existing candidate-side public Jobs behavior is not automatically deleted; employer management access is what is revoked here.

- [ ] **Step 5: Full Hiring regression GREEN and commit**

Run:

```bash
npm test -- src/features/jobs/hiring-repository.test.ts
npm test -- src/features/jobs/hiring-actions.test.ts
npm test -- src/jobs-hiring-experience-contract.test.tsx
```

Suggested commit: `security: require verified organizations for hiring`.

---

## Task 7: Complete exact-head application and infrastructure verification

**Files:**
- No feature scope expansion.
- Fix only issues surfaced by verification.

- [ ] **Step 1: Confirm all guard files are safe before any write operation**

Expected:

```text
scripts/aws/staging-deploy-action.txt = plan
scripts/aws/edge-recovery-action.txt = plan
scripts/aws/jobs-intelligence-migration-action.txt = plan
scripts/aws/organization-hiring-approval-migration-action.txt = plan
```

- [ ] **Step 2: Run/observe exact-head AWS Infrastructure CI**

Require every job green:
- Application verify: lint, typecheck, full Vitest suite;
- Docker build;
- Terraform validation;
- Terraform plan guard tests;
- SSM/security/schema/migration guard contracts.

- [ ] **Step 3: If a failure occurs, use systematic debugging**

Do not patch by guesswork. Identify the first failing invariant, reproduce through the relevant test/CI job, implement the minimum fix, and rerun the exact failing job followed by full exact-head CI.

- [ ] **Step 4: Establish a single tested implementation head**

Do not begin staging migration or deployment until the exact branch head is fully green.

---

## Task 8: Apply 0011 to staging, deploy, restore all guards, and verify runtime

**Files temporarily changed for one-shot operations:**
- `scripts/aws/organization-hiring-approval-migration-action.txt`
- `scripts/aws/staging-deploy-action.txt`

**Safety:**
- Keep `scripts/aws/edge-recovery-action.txt = plan`.
- Keep `scripts/aws/jobs-intelligence-migration-action.txt = plan`.
- Every temporary guard change must be restored in a separate immediate commit after successful operation.

- [ ] **Step 1: Run organization migration in read-only `plan` mode**

Confirm expected pre-migration shape and no partial schema. If partial/unexpected shape is found, stop and investigate rather than applying automatically.

- [ ] **Step 2: Switch organization migration guard `plan` -> `apply-once`**

Commit only this intentional guard change on the feature branch.

- [ ] **Step 3: Require exact-head CI green and apply migration once**

Verify output proves:
- two new tables exist;
- all required indexes/constraints exist;
- legacy approved Hiring companies are verified;
- transaction committed;
- no unrelated schema/data write occurred.

- [ ] **Step 4: Immediately restore organization migration guard to `plan`**

Commit restoration and run a read-only recheck proving `MIGRATION_ALREADY_APPLIED=true` or equivalent idempotent settled state.

- [ ] **Step 5: Run full exact-head CI again at safe head**

- [ ] **Step 6: Switch staging deploy guard `plan` -> `deploy-once`**

Commit only deliberate deployment guard change.

- [ ] **Step 7: Deploy exact tested image through existing AWS staging workflow**

Verify correct AWS account/role, immutable ECR tag/digest, ECS task revision, PRIMARY rollout `COMPLETED`, desired/running/pending `1/1/0`, failed tasks 0.

- [ ] **Step 8: Immediately restore staging deploy guard to `plan`**

Confirm all four relevant guard files are `plan` at the final parked head.

- [ ] **Step 9: Post-deploy verification**

Run existing remote health/runtime verification and browser/root render verification. Confirm no strong new runtime errors in the current PRIMARY deployment.

If an authorized staging admin/test identity is available, perform authenticated acceptance tests:

```text
Organisation onboarding -> organization setup -> pending admin queue
Admin -> approve organization
Owner -> Hiring unlocked -> post job
Individual -> request recruiter access
Owner/Admin -> approve recruiter
Recruiter -> Hiring unlocked
Admin -> suspend organization -> Hiring immediately blocked
```

If a usable authenticated test identity is not available, report that limitation accurately; do not claim manual authenticated click-through was completed merely because build/runtime checks passed.

- [ ] **Step 10: Final verification-before-completion**

Before reporting completion, use `superpowers:verification-before-completion`, cite fresh exact-head CI/deployment evidence, report the final branch SHA, migration state, ECS image/task revision, and every guard value.

---

## Completion Criteria

The feature is complete only when all of these are true:

- Organisation onboarding routes into organization verification setup.
- `/hiring` shows the requested Start Hiring experience for users without organization access.
- New organization applications appear immediately in `/admin/organizations`.
- Platform administrators can approve/request changes/reject/suspend securely.
- Approved organization owner/admin can approve company join/recruiter requests for their own company.
- Platform admin can review/override access requests.
- Approval decisions are audited.
- Only verified organizations with approved owner/administrator/recruiter membership can manage/post jobs.
- A self-declared recruiter or organization profile cannot bypass approval.
- Suspension immediately blocks employer Hiring operations.
- Migration 0011 is applied and idempotently settled on staging.
- Exact tested application is deployed to staging.
- All migration/deployment/edge guards are restored to `plan`.
- `main` remains untouched; no merge and no PR are created.
