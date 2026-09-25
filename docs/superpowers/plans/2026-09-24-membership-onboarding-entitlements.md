# Sea N Shore Membership, Onboarding & Paid Capabilities — Master Checklist

Date started: 2026-09-24
Branch: `feat/aws-native-phase-0-1` only
Status: IN PROGRESS — foundation and persona onboarding implemented in code; staging migration/deploy intentionally not applied yet

## Non-negotiable delivery rules

- [ ] Never write to `main`, merge, create a PR, force-push, or reset.
- [ ] Re-fetch the live feature-branch head immediately before every repository write.
- [ ] Use TDD for behavior changes: failing/contract test first, implementation second.
- [ ] Keep deployment / migration / E2E action guards at `plan` except for explicitly approved one-shot operations.
- [ ] Existing users, jobs, events, LMS content, organization records, applications, messages, and profiles must remain usable.
- [ ] Server-side authorization is mandatory; UI hiding alone never counts as access control.
- [ ] Update this checklist and `CONTINUATION_STATUS.md` after every completed phase.

## Target product model

One human = one Sea N Shore account.

Personal account
→ persona
→ optional organization memberships
→ verification(s)
→ plan
→ entitlements
→ Jobs / Events / LMS capabilities

Organizations are workspaces/pages managed by human accounts, not a competing login identity.

### Plans

**Sea N Shore Member — FREE**
Profile; Feed/community; Connections/followers; Messaging; Search; Apply for jobs; Join events; Enroll in courses; Follow organizations.

**Sea N Shore Creator Pro**
For independent recruiters, consultants, trainers, coaches, event organizers.
Unlocks paid creator capabilities such as job publishing, event publishing and LMS/course publishing, subject to relevant verification.

**Sea N Shore Organization Pro**
For shipping companies, manning agencies, training institutes, maritime colleges, survey companies, service companies and associations.
Adds organization page/workspace, jobs, events, LMS, multiple admins, applicant/student management, analytics, branding, team permissions and company verification.

## Phase 0 — Safety, inventory and continuity

- [x] Confirmed current feature branch and current architecture.
- [x] Confirmed existing organization application / company membership system can be reused.
- [x] Confirmed existing recruiter/company hiring authorization can be reused.
- [x] Confirmed existing mentor approval system can be reused for trainer verification.
- [x] Confirmed Events currently lacks the same centralized creator-access gate.
- [x] Created this persistent master checklist.
- [x] Update `CONTINUATION_STATUS.md` after first implementation slice.

## Phase 1 — Persona-based onboarding

Replace user-facing Professional / Organisation choice with:

- [x] Seafarer
- [x] Shore Professional
- [x] Recruiter / HR
- [x] Trainer / Instructor
- [x] Student / Cadet
- [x] Seafarer Family
- [x] Maritime Enthusiast
- [x] Other

Also capture multi-select intent:
- [x] Find jobs
- [x] Hire people
- [x] Learn
- [x] Teach
- [x] Attend events
- [x] Host events
- [x] Network
- [x] Community

Dynamic onboarding requirements:
- [x] Seafarer asks only relevant rank/company basics.
- [x] Shore Professional asks designation/company basics.
- [x] Recruiter / HR asks designation/company basics.
- [x] Trainer / Instructor asks specialization/company basics.
- [x] Student / Cadet asks institute/course basics.
- [x] Seafarer Family avoids professional maritime fields and can record relationship/interests.
- [x] Maritime Enthusiast avoids professional maritime fields.
- [x] Other remains lightweight.
- [x] Previously entered information survives validation/server/network failures.
- [x] Invalid fields receive human-readable errors and focus/scroll behavior.
- [x] Existing users with old identity fields remain compatible.

## Phase 2 — Organization workspace model

Current note: Create / Claim Organization and safe legacy organisation-profile conversion are implemented and CI-verified.

- [x] Remove organization as a new-user onboarding identity.
- [x] Keep existing `companies`, `company_members`, `organization_applications`, `company_access_requests`.
- [x] Provide Create / Claim Organization after onboarding.
- [x] Existing organization records remain intact.
- [x] Existing organisation-type users receive a safe migration path to a personal account + organization ownership/admin membership.
- [x] Support organization roles: owner, admin, recruiter, LMS manager, event manager, content manager, analyst as required.
- [x] Organization verification remains admin-controlled.
- [x] Organization members never share one organization login.

## Phase 3 — Central entitlement engine

Canonical capabilities:
- [x] `job.publish`
- [x] `event.publish`
- [x] `course.publish`
- [x] `job.manage_applicants`
- [x] `event.manage_attendees`
- [x] `course.manage_students`
- [x] `organization.manage`
- [x] `organization.team`
- [x] `organization.branding`
- [x] `analytics.view`
- [x] `billing.manage`

Architecture:
- [x] Add provider-neutral plan/subscription schema.
- [x] Add plan → entitlement mapping.
- [x] Build one server-side access service (`getAccessContext`, `can`, `requireCapability` or equivalent).
- [x] Keep plan, verification and organization role as separate concepts.
- [x] Add legacy/grandfather access path so existing approved creators are not suddenly locked out.
- [ ] Unit-test all plan/verification/role combinations.

## Phase 4 — Verification model

Current note: Independent Recruiter and Event Host applications now use one evidence-based verification workflow with preserved form values, resubmission after rejection, administrator review/audit, and direct publishing-blocker links. Verification approval never grants a paid entitlement. Integrated CI passed with 353 test files / 1,688 tests.

- [x] Recruiter verification integrates current verified-company/recruiter workflow.
- [x] Independent recruiter can apply/resubmit for Recruiter verification.
- [x] Independent event host can apply/resubmit for Event Host verification.
- [x] Verification applications preserve entered values on validation/server failure.
- [x] Verification approval is audited and does not grant plan entitlements.
- [x] Trainer verification integrates current active mentor workflow.
- [x] Event organizer verification added without granting unrelated permissions.
- [x] Verification status supports pending / approved / rejected / suspended where applicable.
- [x] One person can hold multiple verifications simultaneously.
- [ ] Admin can inspect verification source/status/history.

## Phase 5 — Jobs migration

Current note: personal Creator Pro and Organization Pro publishing now share one server-authorized Publish-as model; the integrated branch passed full application tests and Docker build.

- [x] Free users can still discover and apply for jobs.
- [x] Job publishing checks `job.publish` server-side.
- [x] Independent verified recruiter + Creator Pro can publish personally.
- [x] Verified organization + Organization Pro + appropriate member role can publish for organization.
- [x] Add “Publish as” selector when user has more than one valid publishing identity.
- [x] Existing verified organization recruiters keep working during migration.
- [x] Existing jobs and applicant management remain intact.

## Phase 6 — Events migration

Current note: Events now support personal Creator Pro and Organization Pro publishing identities while preserving the responsible human host and all legacy events.

- [x] Free users can discover/join events.
- [x] Draft/publish policy defined explicitly.
- [x] Event publishing checks `event.publish` server-side.
- [x] Event organizer verification is enforced at publish time.
- [x] Organization event manager path supported.
- [x] Existing hosted events remain editable by their hosts.
- [x] Attendance flows remain unaffected.

## Phase 7 — LMS migration

Current note: Personal Creator Pro trainers and Organization Pro LMS Managers now share one server-authorized publishing model. Organization courses remain compatible with marketplace discovery, enrollment, learner progress, SCORM and certificate issuance. Integrated CI passed with 350 test files / 1,672 tests.

- [x] Free users can discover/enroll in permitted courses.
- [x] Existing active mentor approval becomes trainer verification.
- [x] Course publishing checks `course.publish` server-side.
- [x] Organization LMS manager path supported.
- [x] Existing mentor drafts/courses remain manageable during migration.
- [x] Existing review/approval workflow remains intact.

## Phase 8 — Paid-plan UX

- [x] Add `/plans` with FREE / Creator Pro / Organization Pro.
- [x] Keep paid actions visible to Free users with clear PRO treatment rather than silently hiding them.
- [x] Add upgrade gate for Post Job.
- [x] Add upgrade gate for Create/Publish Event.
- [x] Add upgrade gate for Create/Publish Course.
- [x] Explain verification requirement separately from payment requirement.
- [x] Add plan status to account/settings.
- [ ] Add organization billing-management entry for authorized roles.

## Phase 9 — Billing integration

Current note: pricing and payment provider are intentionally not invented. Billing schema/UI are provider-neutral; production checkout remains open until prices, currency/tax behavior and provider are approved.

- [x] Keep entitlements provider-neutral.
- [ ] Select payment provider before production charging.
- [ ] Define Creator Pro and Organization Pro prices/currency/tax behavior.
- [ ] Checkout creates pending subscription safely.
- [ ] Signed webhook activates/renews/cancels subscriptions.
- [ ] Idempotency and replay protection tested.
- [ ] Failed/expired/cancelled subscription behavior tested.
- [ ] Billing history / invoices links added where provider supports them.
- [ ] No payment card data stored by Sea N Shore.

## Phase 10 — Admin

- [ ] Admin user view shows persona and intents.
- [ ] Admin user view shows plan/subscription.
- [ ] Admin user view shows effective capabilities.
- [ ] Admin user view shows recruiter/trainer/event-host verification.
- [ ] Admin can grant/revoke safe manual/grandfathered entitlements with audit trail.
- [ ] Admin organization view shows plan and authorized managers.
- [ ] Suspension overrides paid access.

## Phase 11 — Migration/backfill

- [ ] Backfill persona for existing users from profile type/identity where deterministic.
- [x] Preserve old identity columns during compatibility period.
- [x] Backfill legacy creator access for existing approved recruiters.
- [x] Backfill legacy creator access for existing active mentors.
- [x] Preserve organization ownership/memberships.
- [x] Migration is additive/reversible where practical.
- [x] Schema contract tests cover new tables/columns/indexes/constraints.

## Phase 12 — Full regression / launch readiness

- [ ] Onboarding E2E: all 8 personas.
- [ ] Onboarding preserves inputs on failure.
- [ ] Free member cannot bypass paid publishing server-side.
- [ ] Creator Pro recruiter job flow.
- [ ] Creator Pro trainer LMS flow.
- [ ] Creator Pro event-host flow.
- [ ] Organization Pro recruiter job flow.
- [ ] Organization Pro LMS manager flow.
- [ ] Organization Pro event manager flow.
- [ ] Existing legacy recruiter regression.
- [ ] Existing legacy mentor regression.
- [ ] Existing organizations regression.
- [ ] Jobs/applications regression.
- [ ] Events/attendance regression.
- [ ] LMS/enrollment/course review regression.
- [ ] Admin/suspension regression.
- [ ] Mobile onboarding UX.
- [ ] Accessibility/keyboard/focus/error states.
- [ ] Staging E2E only after its guard is explicitly armed for the one-shot run.
- [ ] Re-arm all action guards to `plan` after any approved execution.

## Chat handoff protocol

When continuing in a new chat, tell ChatGPT:

> Continue the Sea N Shore membership/onboarding/paid-capabilities implementation. Read `docs/superpowers/plans/2026-09-24-membership-onboarding-entitlements.md` and `CONTINUATION_STATUS.md` from branch `feat/aws-native-phase-0-1`, then fetch the live branch head. Continue from the first unchecked implementation item. Never touch main, merge, create a PR, force-push or reset. Re-fetch feature-branch head immediately before every write. Use TDD and keep execution guards at plan unless I explicitly approve a one-shot execution.

This checklist is the source of truth. Do not rely on chat memory for completion state.
