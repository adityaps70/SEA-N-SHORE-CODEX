# Sea N Shore — Continuation Status

Updated: 25 September 2026

## Active project

Membership, persona onboarding, organization workspaces, verification and paid-capability architecture.

Repository: `adityaps70/SEA-N-SHORE-CODEX`

Branch: `feat/aws-native-phase-0-1` **only**

Master checklist: `docs/superpowers/plans/2026-09-24-membership-onboarding-entitlements.md`

## Non-negotiable repository rules

- Never touch `main`.
- Never merge.
- Never create a PR.
- Never force-push or reset.
- Re-fetch the live feature-branch head immediately before every write.
- Use TDD for behavior changes.
- Keep migration/deployment/E2E guards at `plan` except for an explicitly approved one-shot execution.

## Product model being implemented

One human = one Sea N Shore account.

Personal account
→ persona
→ optional organization membership
→ verification(s)
→ plan
→ entitlements
→ Jobs / Events / LMS capabilities.

Organizations are workspaces/pages managed by human accounts, not a competing login identity.

Plans:
- Sea N Shore Member — FREE
- Creator Pro
- Organization Pro

## Implemented in code in this continuation

### Persona onboarding
- Replaced user-facing Professional / Organisation onboarding choice with:
  - Seafarer
  - Shore Professional
  - Recruiter / HR
  - Trainer / Instructor
  - Student / Cadet
  - Seafarer Family
  - Maritime Enthusiast
  - Other
- Added multi-select intent:
  - Find jobs
  - Hire people
  - Learn
  - Teach
  - Attend events
  - Host events
  - Network
  - Community
- Added persona-specific lightweight fields.
- Seafarer Family and Maritime Enthusiast no longer receive irrelevant professional maritime questions.
- Existing form-error preservation, focus/scroll and human-readable error handling are retained.
- Existing legacy identity fields remain in the schema for compatibility.

### Central access architecture
Added `src/features/access/` with:
- plan codes
- canonical capabilities
- verification types
- organization-role capability policy
- database-backed access context
- server-side `requireCapability` guard

Payment, verification and organization role are independent concepts.

### Canonical creator capabilities
- `job.publish`
- `event.publish`
- `course.publish`
- applicant / attendee / student management capabilities
- organization management/team/branding
- analytics
- billing management

### Jobs
- Job creation now checks central `job.publish` server-side for the selected organization.
- Existing company/recruiter authorization remains in place.
- Legacy verified hiring organizations receive narrow grandfather grants in the migration.
- Independent Creator Pro recruiter publishing is **not yet implemented**; current job creation is still company-based.

### Events
- Draft creation remains available.
- Publishing a new event, or updating an event to published state, checks `event.publish` server-side.
- Existing event hosts receive narrow legacy verification/grants in the migration.
- Organization event-manager publishing context is **not yet wired**.

### LMS
- Existing mentor approval remains the trainer trust source.
- Submitting a course for review now checks `course.publish` server-side.
- Existing active mentors receive trainer verification plus a narrow legacy course-publish grant in the migration.
- Organization LMS-manager authoring is **not yet wired**.

### Organization model
- Organization is removed from new-user onboarding.
- Existing company/application/membership tables are preserved.
- Organization verification copy now explicitly says verification and paid plan access are separate.
- Migration extends organization roles with:
  - lms_manager
  - event_manager
  - content_manager
  - analyst
- Existing Create Organization flow remains.
- Claim Existing Organization is now implemented end-to-end:
  - users search before creating duplicates
  - users request Member / Recruiter / Administrator access
  - duplicate membership/pending request protection
  - member request status is visible
  - admins review at `/admin/access`
  - approval creates/updates individual membership
  - decisions write audit history
- Legacy users whose personal profile was originally an organization identity still need a safe conversion path.

### Paid-plan UX
- Added `/plans` with Member FREE / Creator Pro / Organization Pro.
- Added `/settings/billing`.
- Settings links to Membership & billing.
- UI explains that payment never bypasses verification.
- Prices and payment provider have intentionally not been invented.
- No fake checkout is shown.

### Database foundation
Added migration:
`infra/aws/database/migrations/0032_membership_access_foundation.sql`

It adds:
- persona/profile intents
- community relationship/institution/specialization fields
- organization workspace roles
- plan entitlements
- provider-neutral subscriptions
- feature verifications
- manual/legacy entitlement grants
- legacy recruiter/trainer/event-host backfills

The migration is additive and retains legacy identity fields.

### Migration safety
Added:
- `scripts/aws/membership-access-schema.test.mjs`
- `scripts/aws/membership-access-migration.sh`
- `scripts/aws/membership-access-migration-action.txt`
- `.github/workflows/aws-membership-access-migration.yml`

The migration action guard remains:
`plan`

No membership schema migration has been intentionally applied to staging yet.

## Tests added/updated

- central capability policy tests
- membership access schema contract
- persona onboarding schema tests
- persona onboarding service tests
- persona onboarding UI contract
- job publishing capability test
- event publishing capability tests
- course publishing capability tests
- plans page contract
- billing settings contract
- organization verification/payment separation contract

## Important remaining work

Use the master checklist as the authoritative list. Highest-priority unfinished items are:

1. Safe conversion of legacy organization-type profiles to human account + organization ownership/admin.
2. Independent Creator Pro recruiter job publishing and a reusable “Publish as” identity selector.
3. Organization Event Manager and LMS Manager authoring contexts.
4. New-user recruiter and event-host verification application flows; trainer can continue using the existing mentor/trainer review flow.
5. Admin views for persona, plan, capabilities, verification and entitlement history.
6. Paid-feature upgrade UI at the exact Post Job / Publish Event / Submit Course moments.
7. Pricing decision, currency/tax behavior and payment-provider selection.
8. Checkout/webhook/idempotency/invoice implementation after pricing/provider approval.
9. Existing-user persona backfill where deterministic.
10. Full staging migration, deploy and E2E only through guarded one-shot execution.

## Exact next action

Continue with **Phase 2: safe conversion of legacy organisation-type profiles to human account + organization ownership/admin**, using TDD. Current head before this documentation update passed full AWS Infrastructure CI and AWS Remote Verify.

Do not apply the membership migration or deploy new schema-dependent application code until CI is green and the one-shot staging migration/deploy sequence is explicitly armed.

## New-chat handoff prompt

> Continue the Sea N Shore membership/onboarding/paid-capabilities implementation. Read `docs/superpowers/plans/2026-09-24-membership-onboarding-entitlements.md` and `CONTINUATION_STATUS.md` from `adityaps70/SEA-N-SHORE-CODEX` branch `feat/aws-native-phase-0-1`, then fetch the live branch head. Continue from the first unfinished item in the master checklist / Exact next action. Never touch main, merge, create a PR, force-push or reset. Re-fetch the live feature-branch head immediately before every repository write. Use TDD. Keep all migration/deployment/E2E guards at plan unless I explicitly approve a one-shot execution.

This file plus the master checklist are the persistent source of truth; do not rely on chat memory for completion state.
