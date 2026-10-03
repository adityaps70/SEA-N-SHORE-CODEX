# Maritime Passport Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the basic Sea N Shore member profile with a production Maritime Passport containing persisted career experience, certifications, recruiter-scannable maritime data, public parity, share/export entry points, and completion guidance.

**Architecture:** Keep `PublicProfile` / `OwnProfile` as the identity aggregate and add focused repositories for profile portfolio records rather than inflating the existing profile row. The owner and public pages compose the same presentational Passport sections, with owner-only controls passed explicitly. Additive Aurora tables store career experience and credentials; existing inline identity/about/maritime actions remain intact.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, PostgreSQL/Aurora, Zod, Vitest/Testing Library, Tailwind CSS, lucide-react.

**Spec:** `docs/superpowers/specs/2026-09-09-maritime-passport-profile.md`

## Global Constraints

- Work only on `feat/aws-native-phase-0-1`.
- Do not touch `main`, merge, or create a PR.
- Do not change Home or onboarding behavior.
- Aurora stays the application database and Cognito stays `COGNITO_DEFAULT`.
- SES Phase 5B stays paused; no production DNS/nameserver change.
- Do not decommission Vercel or Supabase.
- All schema work is additive.
- Never display a formal verification badge for self-reported credentials.
- RED → GREEN → exact-head CI → guarded migration → guarded staging deploy → fresh runtime verification → switches back to `plan`.

---

### Task 1: Passport presentation contract and readiness model

**Files:**
- Create: `src/features/profiles/profile-readiness.ts`
- Create: `src/features/profiles/profile-readiness.test.ts`
- Create: `src/features/profiles/components/profile-passport-toolbar.tsx`
- Create: `src/features/profiles/components/profile-passport-overview.tsx`
- Create: `src/features/profiles/components/profile-passport-overview.test.tsx`
- Modify: `src/app/(app)/profile/page.tsx`
- Modify: `src/app/(public)/people/[slug]/page.tsx`

**Interfaces:**
- Consumes: `OwnProfile` / `PublicProfile`.
- Produces: `getProfileReadiness(profile)`, shared Passport overview component, owner toolbar.

- [ ] Write failing tests requiring Maritime Passport language, readiness guidance, recruiter-scannable maritime snapshot, owner share/CV actions, and public-safe rendering.
- [ ] Run the focused Vitest files and confirm RED for missing components/labels.
- [ ] Implement deterministic readiness scoring from stored profile fields only.
- [ ] Implement responsive Passport overview and toolbar without fabricated metrics.
- [ ] Wire owner and public pages to the shared components.
- [ ] Run focused tests to GREEN and commit.

### Task 2: Persisted career timeline schema and repository

**Files:**
- Create: `infra/aws/database/migrations/0006_profile_passport.sql`
- Create: `src/features/profiles/profile-portfolio-types.ts`
- Create: `src/features/profiles/profile-portfolio-repository.ts`
- Create: `src/features/profiles/profile-portfolio-repository.test.ts`
- Modify: `src/features/profiles/queries.ts`

**Interfaces:**
- Produces: `ProfileExperienceRecord`, `ProfileCredentialRecord`, `getProfilePortfolio(profileId)` and owner/public portfolio query helpers.

- [ ] Write repository contract tests for ordered experience/credential hydration, self-reported verification defaults, and blocked/invalid data boundaries.
- [ ] Run focused tests and confirm RED.
- [ ] Add additive tables `profile_experiences` and `profile_credentials` with bounded constraints and indexes.
- [ ] Implement repository reads and map DB rows to typed records.
- [ ] Expose own/public portfolio query helpers using authenticated profile IDs.
- [ ] Run focused tests to GREEN and commit.

### Task 3: Career timeline owner CRUD with role-specific editor

**Files:**
- Create: `src/features/profiles/profile-portfolio-schemas.ts`
- Create: `src/features/profiles/profile-portfolio-actions.ts`
- Create: `src/features/profiles/components/profile-career-timeline.tsx`
- Create: `src/features/profiles/components/profile-career-timeline.test.tsx`
- Modify: `src/features/profiles/profile-portfolio-repository.ts`
- Modify: `src/app/(app)/profile/page.tsx`
- Modify: `src/app/(public)/people/[slug]/page.tsx`

**Interfaces:**
- Consumes: portfolio repository.
- Produces: add/update/delete experience actions and shared timeline component.

- [ ] Write failing tests for sea-service vs shore-role field adaptation and public read-only rendering.
- [ ] Run focused tests and confirm RED.
- [ ] Implement Zod schemas with track-specific validation.
- [ ] Implement authenticated create/update/delete repository methods and server actions with path revalidation.
- [ ] Implement owner editor plus read-only public timeline; hide empty public timeline.
- [ ] Run focused tests to GREEN and commit.

### Task 4: Certification wallet owner CRUD

**Files:**
- Create: `src/features/profiles/components/profile-credential-wallet.tsx`
- Create: `src/features/profiles/components/profile-credential-wallet.test.tsx`
- Modify: `src/features/profiles/profile-portfolio-schemas.ts`
- Modify: `src/features/profiles/profile-portfolio-actions.ts`
- Modify: `src/features/profiles/profile-portfolio-repository.ts`
- Modify: owner/public profile pages.

**Interfaces:**
- Produces: add/update/delete credential actions and shared wallet component.

- [ ] Write failing tests requiring certificate/CoC fields, expiry handling, and `Self-reported` state with no false verified badge.
- [ ] Run focused tests and confirm RED.
- [ ] Implement credential validation and authenticated CRUD.
- [ ] Implement responsive wallet and empty-state owner prompt; omit empty public wallet.
- [ ] Run focused tests to GREEN and commit.

### Task 5: Profile share, QR-ready URL and CV export

**Files:**
- Create: `src/features/profiles/components/profile-share-controls.tsx`
- Create: `src/features/profiles/components/profile-share-controls.test.tsx`
- Create: `src/app/api/profile/cv/route.ts`
- Create: `src/app/api/profile/cv/route.test.ts`
- Modify: `src/features/profiles/components/profile-passport-toolbar.tsx`

**Interfaces:**
- Produces: canonical public-profile URL copy/share UI and authenticated CV download endpoint generated from current profile + portfolio.

- [ ] Write failing tests for canonical share URL and server-generated CV response.
- [ ] Run focused tests and confirm RED.
- [ ] Implement share/copy behavior with graceful browser fallback.
- [ ] Implement a printable professional CV response from stored identity, maritime snapshot, experience, credentials and skills.
- [ ] Run focused tests to GREEN and commit.

### Task 6: Full verification, guarded migration and staging rollout

**Files:**
- Modify only deployment/migration action switch files temporarily as required by existing guarded workflows.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: migrated and deployed staging application with switches restored to `plan`.

- [ ] Run exact-head AWS Infrastructure CI and confirm every job succeeds.
- [ ] Execute the existing guarded database migration path for `0006_profile_passport.sql` and verify schema health.
- [ ] Trigger one guarded staging deploy from the exact tested head.
- [ ] Run fresh remote runtime/HTTP verification after ECS reports the new PRIMARY deployment `COMPLETED`.
- [ ] Verify owner/public profile routes and health endpoints without claiming screenshot-level visual proof unless a browser capture exists.
- [ ] Return staging deploy and any migration/recovery switches to `plan` and run final exact-head verification.
