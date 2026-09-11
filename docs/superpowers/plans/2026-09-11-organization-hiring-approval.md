# Sea N Shore Organization Hiring Approval Implementation Plan

> **Execution method:** task-isolated RED → observed failure → GREEN → scoped review, followed by a whole-branch review and exact-head staging verification.

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
- Use RED → observed CI failure → GREEN for implementation slices.
- Never grant organization, recruiter, Hiring, or admin permissions from a client-side flag or self-declared profile type.
- Platform administrator checks must use `public.user_roles(role = 'administrator')`.
- Hiring requires both verified company and approved hiring-capable membership.
- Existing staging employers with already-approved hiring-capable memberships must not be accidentally locked out by the new company-verification enforcement. Migration 0011 will compatibility-backfill those existing companies to verified before enforcement takes effect.

---

### Task 1: Additive organization approval schema and domain repository

**Files:**
- Create: `infra/aws/database/migrations/0011_organization_hiring_approval.sql`
- Create: `scripts/aws/organization-hiring-approval-schema.test.mjs`
- Create: `src/features/organizations/types.ts`
- Create: `src/features/organizations/schemas.ts`
- Create: `src/features/organizations/repository.test.ts`
- Create: `src/features/organizations/repository.ts`
- Modify: `.github/workflows/aws-infra-ci.yml`

**Required behavior:**
- Add `organization_applications` with statuses `pending`, `changes_requested`, `approved`, `rejected`, `suspended`.
- Add `company_access_requests` with request types `join_company`, `recruiter_access` and statuses `pending`, `approved`, `rejected`, `cancelled`.
- Prevent duplicate pending requests for the same company/user/requested role.
- Add admin/user/company queue indexes.
- Compatibility-backfill existing companies that already have an approved owner/administrator/recruiter membership to `companies.is_verified = true`, without revoking anything.
- Repository reads current user organization state, company search results, organization application detail, and access requests.
- Repository submission creates company + unapproved owner membership + pending organization application in one transaction.
- Organization resubmission updates the existing application rather than creating a second company.

**TDD:**
1. Add schema/repository tests only.
2. Commit RED and observe exact-head AWS Infrastructure CI fail because 0011/repository do not exist.
3. Implement minimal migration/types/schemas/repository and register schema contract in CI.
4. Require exact-head CI GREEN.
5. Scoped review against the spec.

### Task 2: Organization application actions and setup experience

**Files:**
- Create: `src/features/organizations/actions.test.ts`
- Create: `src/features/organizations/actions.ts`
- Create: `src/features/organizations/components/organization-application-form.tsx`
- Create: `src/app/(app)/hiring/organization/page.tsx`
- Modify: `src/features/profiles/actions.test.ts`
- Modify: `src/features/profiles/onboarding-activation-service.test.ts` where needed for regression coverage
- Modify: `src/features/profiles/actions.ts`

**Required behavior:**
- Organisation onboarding redirects to `/hiring/organization`; professional onboarding remains `/home`.
- Organization setup collects organization name/type, website, official email, office location, description, fleet summary, vessel types, applicant relationship/role, optional registration/reference, supporting notes.
- Submission and resubmission use authenticated server identity only.
- Pending/changes-requested/rejected/suspended states render status and admin note; only permitted states expose update/resubmit.
- Approved state routes the user back to `/hiring`.
- Validation happens before mutation and repository failures return safe user copy.

**TDD:** test action/redirect contracts first, observe RED, then implement and require exact-head GREEN.

### Task 3: Platform Admin authorization and organization review center

**Files:**
- Create: `src/features/admin/repository.test.ts`
- Create: `src/features/admin/repository.ts`
- Create: `src/features/admin/actions.test.ts`
- Create: `src/features/admin/actions.ts`
- Create: `src/features/admin/components/admin-subnav.tsx`
- Create: `src/app/(app)/admin/page.tsx`
- Create: `src/app/(app)/admin/organizations/page.tsx`
- Create: `src/app/(app)/admin/organizations/[applicationId]/page.tsx`

**Required behavior:**
- `isPlatformAdministrator(userId)` checks only `public.user_roles` with role `administrator`.
- Non-admin reads/actions fail closed.
- Admin dashboard counters: Pending Organizations, Changes Requested, Approved Organizations, Suspended Organizations, Pending Access Requests.
- Organization review supports Approve, Request Changes, Reject, Suspend.
- Approval transaction verifies company, approves founding owner membership, updates application, and writes `audit_events`.
- Suspension transaction un-verifies the company immediately, updates application, and writes `audit_events`.
- Review decisions cannot be performed by the submitting user unless they separately hold platform administrator role; role check still governs.

**TDD:** repository/action tests first, observe RED, implement minimal admin routes/actions, exact-head GREEN, scoped review.

### Task 4: Join company and recruiter access workflow

**Files:**
- Extend: `src/features/organizations/repository.test.ts`
- Extend: `src/features/organizations/repository.ts`
- Extend: `src/features/organizations/actions.test.ts`
- Extend: `src/features/organizations/actions.ts`
- Create: `src/features/organizations/components/company-access-request-form.tsx`
- Create: `src/app/(app)/hiring/access/page.tsx`
- Create: `src/app/(app)/hiring/access/[requestId]/page.tsx` if detail state is required
- Create: `src/app/(app)/hiring/team/page.tsx`
- Create: `src/features/organizations/components/company-access-review.tsx`

**Required behavior:**
- `Join Existing Company` requests `member`.
- `Request Recruiter Access` requests `recruiter`.
- Duplicate pending company/user/role request is blocked.
- Requests never self-approve.
- Approved company owner/administrator can approve/reject requests only for their own verified company.
- Company approval transaction upserts/updates `company_members`, sets `approved_at`, and writes `audit_events`.
- Platform administrator may review/override any request through Task 3 admin authority.
- Recruiter access never comes from profile type.

**TDD:** add request/approval tests, observe RED, implement, exact-head GREEN, scoped review.

### Task 5: Context-aware `/hiring` state machine

**Files:**
- Create/extend: `src/jobs-hiring-experience-contract.test.tsx`
- Modify: `src/app/(app)/hiring/page.tsx`
- Modify: `src/features/jobs/components/hiring-subnav.tsx`
- Potentially create: `src/features/organizations/hiring-state.ts`
- Create tests for state resolution.

**Required behavior:**
- Approved verified employer + approved hiring-capable membership: existing Hiring dashboard.
- Pending organization application: Verification in progress.
- Changes requested: admin note + Update application / Resubmit.
- Rejected: decision + explicit resubmission path only.
- Suspended: access suspended, no self-reactivation.
- No relationship: `Start Hiring on Sea N Shore` with Create Company Profile, Join Existing Company, Request Recruiter Access.
- Existing wider product remains accessible while approval is pending.

**TDD:** state/UI contract tests first, observe RED, implement, exact-head GREEN, scoped review.

### Task 6: Enforce verified-company Hiring authorization and expose Admin entry

**Files:**
- Modify: `src/features/jobs/hiring-repository.test.ts`
- Modify: `src/features/jobs/hiring-repository.ts`
- Create/modify navigation tests.
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/components/navigation/app-header.tsx`
- Modify: `src/components/navigation/mobile-app-header.tsx` or an appropriate mobile admin entry surface.

**Required behavior:**
- Every Hiring employer read/write authorization path requires `c.is_verified = true`, approved membership, and role owner/administrator/recruiter.
- Unverified company is denied even if membership is approved.
- Suspension therefore disables Hiring immediately.
- Admin link/badge is shown only when server-derived `user_roles` says administrator; normal users do not see it.
- Preserve candidate Jobs and social navigation behavior.

**TDD:** add authorization/navigation tests first, observe RED, implement minimal changes, exact-head GREEN, scoped review.

### Task 7: Guarded migration 0011 execution path

**Files:**
- Create: `scripts/aws/organization-hiring-approval-migration-action.txt` with `plan`
- Create: `scripts/aws/organization-hiring-approval-migration.sh`
- Create: `scripts/aws/organization-hiring-approval-migration.test.mjs`
- Create: `.github/workflows/aws-organization-hiring-approval-migration.yml`
- Modify: `.github/workflows/aws-infra-ci.yml`

**Required behavior:**
- Correct AWS account `310356785722`, exact branch SHA, exact-head green CI, OIDC, SSM, branch-move protection.
- Additive SQL allowlist plus only the specifically approved compatibility backfill update(s).
- Read-only `plan` by default; `apply-once` only for deliberate staging execution.
- Transactional execution and live schema/backfill shape verification.
- Idempotent already-applied proof.

**TDD:** guard contract first and observed RED, then runner/workflow GREEN.

### Task 8: Whole-branch review, staging migration, deploy, and post-deploy verification

**Required behavior:**
1. Run broad whole-branch code review against the approved spec.
2. Resolve load-bearing findings and re-run exact-head CI.
3. Confirm all guards are `plan`.
4. Run 0011 migration read-only plan against staging.
5. Temporarily set only the 0011 migration guard to `apply-once`; require exact-head CI; apply once; prove schema/backfill state; restore guard to `plan`; re-check read-only idempotence.
6. Temporarily set only staging deploy guard to `deploy-once`; require exact-head CI; deploy the exact commit; restore staging guard to `plan` immediately.
7. Run post-deploy HTTP/runtime/CloudWatch verification and Chromium/browser verification available in existing workflows.
8. Final branch state must have staging deploy, edge recovery, jobs intelligence migration, and organization approval migration guards all at `plan`.
9. Do not touch main, merge, or create a PR.
