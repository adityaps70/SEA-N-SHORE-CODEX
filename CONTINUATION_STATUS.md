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
- Job publishing now supports two explicit publisher identities: personal recruiter and organization workspace.
- Personal publishing requires approved recruiter verification plus personal `job.publish` entitlement (Creator Pro or an applicable grant).
- Organization publishing requires the selected organization membership/verification plus organization-scoped `job.publish` entitlement.
- Added reusable `buildHiringPublisherOptions` policy and a visible **Publish as** selector.
- Free/unverified identities remain visible with separate `upgrade_required` or `verification_required` blockers instead of silently disappearing.
- Hiring overview, vacancy list and metrics now combine personally published and organization-published jobs.
- Personal recruiter vacancies support edit, applicant review, pipeline status updates and recruiter notes without a company membership.
- Publisher identity is locked after job creation; editing cannot move a vacancy between personal and organization identities.
- Global Start Hiring access now recognizes approved personal recruiters as well as authorized hiring organizations.
- Existing company/recruiter authorization and legacy verified organization access remain compatible.
- Phase 5 integrated verification passed: Docker build, Terraform validations/guards and full application suite (344 test files / 1,617 tests).

### Events
- Draft creation remains available even when an identity is not yet eligible to publish.
- Added reusable personal/organization **Publish as** identities for Events.
- Personal publishing requires Event Host verification plus personal `event.publish` entitlement.
- Organization publishing supports approved Owner / Administrator / Event Manager roles and checks organization-scoped `event.publish`.
- Events keep `host_user_id` as the responsible human manager and add nullable `company_id` for organization publishing, preserving all legacy events.
- Organization event managers can manage hosted-event lists, drafts, edits, cancellations and attendee-facing event access without sharing an organization login.
- Republish/edit authorization resolves the event's stored publisher server-side, so a client cannot switch entitlement scope.
- Free or unverified publisher identities stay visible with separate upgrade/verification blockers and can still save drafts.
- Public cards/details show the selected publisher; organization-hosted events show verified organization status.
- Existing event hosts retain narrow legacy verification/grants in the migration.
- Phase 6 integrated CI passed: application verify, Docker, Terraform validations/guards and execution contract.

### LMS
- Existing mentor approval remains the trainer trust source for personal trainer publishing.
- Personal Creator Pro and Organization Pro LMS publishing now share one explicit **Publish as** model.
- Personal course publishing requires Trainer verification plus personal `course.publish`.
- Organization course publishing supports approved Owner / Administrator / LMS Manager roles and organization-scoped `course.publish`.
- Organization course drafts can be created without pretending the manager is a personal mentor.
- Course publisher identity is stored and locked after creation; submit-for-review resolves the stored publisher server-side before checking entitlement.
- Studio course creation/editing, curriculum, materials, media, assignment grading and analytics all use one centralized Mentor-or-LMS-Manager authorization rule.
- Organization-published courses remain visible and usable through marketplace discovery, free enrollment, learner course access, progress, SCORM and certificate issuance.
- Existing personal mentor drafts/courses and review/approval behavior remain compatible.
- Existing active mentors receive trainer verification plus a narrow legacy course-publish grant in the migration.
- Free or unverified identities stay visible with separate verification/PRO blockers and can still save drafts.
- Phase 7 integrated CI passed: 350 test files / 1,672 tests, Docker, Terraform validations/guards, execution contract and Remote Verify.


### Verification applications
- Independent Recruiter and Event Host verification applications are implemented under Settings.
- Applications capture professional role, organization (optional), years of relevant experience, focus areas, experience summary, optional public evidence URL and additional note.
- Validation errors preserve previously entered values; rejected applications can be corrected and resubmitted.
- Pending, approved and suspended verification states are protected from duplicate submission.
- Administrator review is available at `/admin/verifications` with status/type filters, evidence review, approve/reject controls and audit events.
- Recruiter and Event publishing blockers now link directly to the correct verification application.
- Verification approval changes only the verification record; it never creates a subscription or `entitlement_grants` record.
- The additive membership migration stores verification application payload + submission time while retaining legacy trust backfills.
- Integrated CI passed: 353 test files / 1,688 tests, Docker, Terraform validations/guards, execution contract and Remote Verify.

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
- Legacy organization-style accounts now have a safe one-time conversion path:
  - legacy organization data is snapshotted before conversion
  - the human user enters their real personal identity
  - existing Owner/Admin workspace can be linked
  - or a new unverified organization can be explicitly created from the old profile
  - duplicate organization names are blocked and redirected to Claim Existing Organization
  - old logo/description/location transfer to the organization workspace
  - company branding is cleared from the converted personal profile
  - the same user ID/login/history/messages/posts/connections remain
  - conversion is audit logged
  - pending legacy users receive a non-blocking in-app conversion reminder

### Admin membership visibility & entitlement controls
- Admin user detail shows persona, profile intents, current plan/subscription, effective capabilities, Recruiter/Trainer/Event Host verification source/status, verification audit history and entitlement history.
- Admin organization detail shows organization plan/subscription, verification state, authorized managers and organization entitlement history.
- Manual personal grants are limited to narrow creator-publishing capabilities; organization grants are limited to approved workspace capabilities.
- Admin/grandfather entitlement grant and revoke operations require reasons and write audit events.
- Manual grants do not change subscription plan and still cannot bypass professional verification.
- Suspension overrides Creator Pro, manual/grandfather grants and organization-scoped capabilities through the central access policy.
- Phase 10 integrated CI passed: 357 test files / 1,706 tests, Docker, Terraform validations/guards, execution contract and Remote Verify.

### Paid-plan UX
- Added `/plans` with Member FREE / Creator Pro / Organization Pro.
- Added `/settings/billing`.
- Settings links to Membership & billing.
- UI explains that payment never bypasses verification.
- Prices and payment provider have intentionally not been invented.
- No fake checkout is shown.

### Organization billing management
- `/settings/billing` lists organization billing-management links only when the member's effective organization access includes `billing.manage`.
- `/settings/billing/organizations/[companyId]` rechecks `billing.manage` server-side before showing any organization billing state.
- The organization billing view is provider-neutral and read-only: current plan, subscription status, billing-provider label, billing period and cancellation state.
- Provider customer/subscription secrets are not selected for this user-facing view.
- Pricing, currency/tax behavior, payment provider and checkout remain intentionally unimplemented rather than being invented.
- Organization billing integrated CI passed: 359 test files / 1,712 tests, Docker, Terraform validations/guards, execution contract and Remote Verify.

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

Deterministic existing-user persona backfill is now implemented in migration `0032`:
- fills only completed profiles where `persona is null`
- maps only unambiguous legacy profile/identity values
- never overwrites an explicit persona
- leaves ambiguous legacy identities untouched for progressive prompting
- remains additive/non-destructive

The migration contract is green. A prior migration-workflow failure after the contract fix was the expected moved-branch safety guard refusing stale execution, not a SQL contract failure.

The migration action guard remains:
`plan`

No membership schema migration has been intentionally applied to staging yet.

### Authorization matrix and launch regression
- Added exhaustive central-policy coverage for every personal plan × verification combination × capability.
- Added exhaustive organization plan × role × verification-state × capability coverage.
- Organization-scoped manual grants are regression-tested so they cannot escape the selected company/role scope.
- Exact-head application verification passed at 359 test files / 1,721 tests.
- Docker build, Terraform validations, Terraform plan guards and GitHub SSM execution-contract checks passed on the same implementation head.

### Guarded eight-persona onboarding E2E readiness
- Replaced the obsolete Professional / Organisation staging browser journeys with all eight current persona journeys.
- The harness now creates disposable Seafarer, Shore Professional, Recruiter / HR, Trainer / Instructor, Student / Cadet, Seafarer Family, Maritime Enthusiast and Other users.
- It verifies intent selection, persona-specific fields, username protections, profile completion and database persistence for `persona` / `profile_intents` plus compatible legacy profile projections.
- Representative persona journeys use a 390×844 mobile viewport and assert no horizontal overflow.
- Every persona onboarding state runs an Axe scan that fails on serious/critical accessibility violations.
- CI now also exercises keyboard activation of persona/intent buttons, selected `aria-pressed` state, username description linkage, error-summary focus and mobile-first responsive layout contracts.
- Cleanup remains guarded and deletes only disposable E2E identities.
- `scripts/aws/onboarding-e2e-action.txt` remains `plan`.
- Exact-head CI is green at 359 test files / 1,721 tests, including Docker, Terraform validations/guards, SSM execution contract and Remote Verify.
- The onboarding workflow parses and completes successfully in plan mode, but the live eight-persona staging journey has **not** been executed.

## Tests added/updated

- exhaustive central plan / verification / organization-role capability matrix
- membership access schema contract, including deterministic persona backfill
- persona onboarding schema tests
- persona onboarding service tests
- persona onboarding UI contract
- onboarding error/input-preservation component regression
- eight-persona guarded staging E2E contract and browser harness
- job publishing capability test
- event publishing capability tests
- course publishing capability tests
- plans page contract
- billing settings contract
- organization verification/payment separation contract

## Important remaining work

Use the master checklist as the authoritative list. Highest-priority unfinished items are:

1. Live all-eight-persona staging onboarding E2E, only as part of the explicitly approved guarded migration → deploy → E2E one-shot sequence.
2. Re-arm every execution guard to `plan` immediately after any approved one-shot staging execution.
3. Pricing decision, currency/tax behavior and payment-provider selection.
4. Checkout/webhook/idempotency/invoice implementation after pricing/provider approval.

## Exact next action

All remaining **non-deployment onboarding/membership implementation and regression work is complete** for the currently approved scope.

The next technical launch step requires explicit approval to run the guarded staging sequence: membership migration → schema-dependent application deploy → all-eight-persona browser E2E/persistence/mobile/accessibility verification → re-arm every action guard to `plan`. Until that approval is given, keep all execution guards at `plan` and do not apply or deploy the new membership schema.

Billing remains separately blocked on product decisions for Creator Pro / Organization Pro pricing, currency/tax treatment and payment provider.

## New-chat handoff prompt

> Continue the Sea N Shore membership/onboarding/paid-capabilities implementation. Read `docs/superpowers/plans/2026-09-24-membership-onboarding-entitlements.md` and `CONTINUATION_STATUS.md` from `adityaps70/SEA-N-SHORE-CODEX` branch `feat/aws-native-phase-0-1`, then fetch the live branch head. Continue from the first unfinished item in the master checklist / Exact next action. Never touch main, merge, create a PR, force-push or reset. Re-fetch the live feature-branch head immediately before every repository write. Use TDD. Keep all migration/deployment/E2E guards at plan unless I explicitly approve a one-shot execution.

This file plus the master checklist are the persistent source of truth; do not rely on chat memory for completion state.
