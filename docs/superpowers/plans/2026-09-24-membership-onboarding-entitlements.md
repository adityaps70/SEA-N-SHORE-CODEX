# Sea N Shore Membership, Onboarding & Paid Capabilities — Master Checklist

Date started: 2026-09-24
Branch: `feat/aws-native-phase-0-1` only
Status: IN PROGRESS

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
- [ ] Update `CONTINUATION_STATUS.md` after first implementation slice.

## Phase 1 — Persona-based onboarding

Replace user-facing Professional / Organisation choice with:

- [ ] Seafarer
- [ ] Shore Professional
- [ ] Recruiter / HR
- [ ] Trainer / Instructor
- [ ] Student / Cadet
- [ ] Seafarer Family
- [ ] Maritime Enthusiast
- [ ] Other

Also capture multi-select intent:
- [ ] Find jobs
- [ ] Hire people
- [ ] Learn
- [ ] Teach
- [ ] Attend events
- [ ] Host events
- [ ] Network
- [ ] Community

Dynamic onboarding requirements:
- [ ] Seafarer asks only relevant rank/company basics.
- [ ] Shore Professional asks designation/company basics.
- [ ] Recruiter / HR asks designation/company basics.
- [ ] Trainer / Instructor asks specialization/company basics.
- [ ] Student / Cadet asks institute/course basics.
- [ ] Seafarer Family avoids professional maritime fields and can record relationship/interests.
- [ ] Maritime Enthusiast avoids professional maritime fields.
- [ ] Other remains lightweight.
- [ ] Previously entered information survives validation/server/network failures.
- [ ] Invalid fields receive human-readable errors and focus/scroll behavior.
- [ ] Existing users with old identity fields remain compatible.

## Phase 2 — Organization workspace model

- [ ] Remove organization as a new-user onboarding identity.
- [ ] Keep existing `companies`, `company_members`, `organization_applications`, `company_access_requests`.
- [ ] Provide Create / Claim Organization after onboarding.
- [ ] Existing organization records remain intact.
- [ ] Existing organisation-type users receive a safe migration path to a personal account + organization ownership/admin membership.
- [ ] Support organization roles: owner, admin, recruiter, LMS manager, event manager, content manager, analyst as required.
- [ ] Organization verification remains admin-controlled.
- [ ] Organization members never share one organization login.

## Phase 3 — Central entitlement engine

Canonical capabilities:
- [ ] `job.publish`
- [ ] `event.publish`
- [ ] `course.publish`
- [ ] `job.manage_applicants`
- [ ] `event.manage_attendees`
- [ ] `course.manage_students`
- [ ] `organization.manage`
- [ ] `organization.team`
- [ ] `organization.branding`
- [ ] `analytics.view`
- [ ] `billing.manage`

Architecture:
- [ ] Add provider-neutral plan/subscription schema.
- [ ] Add plan → entitlement mapping.
- [ ] Build one server-side access service (`getAccessContext`, `can`, `requireCapability` or equivalent).
- [ ] Keep plan, verification and organization role as separate concepts.
- [ ] Add legacy/grandfather access path so existing approved creators are not suddenly locked out.
- [ ] Unit-test all plan/verification/role combinations.

## Phase 4 — Verification model

- [ ] Recruiter verification integrates current verified-company/recruiter workflow.
- [ ] Trainer verification integrates current active mentor workflow.
- [ ] Event organizer verification added without granting unrelated permissions.
- [ ] Verification status supports pending / approved / rejected / suspended where applicable.
- [ ] One person can hold multiple verifications simultaneously.
- [ ] Admin can inspect verification source/status/history.

## Phase 5 — Jobs migration

- [ ] Free users can still discover and apply for jobs.
- [ ] Job publishing checks `job.publish` server-side.
- [ ] Independent verified recruiter + Creator Pro can publish personally.
- [ ] Verified organization + Organization Pro + appropriate member role can publish for organization.
- [ ] Add “Publish as” selector when user has more than one valid publishing identity.
- [ ] Existing verified organization recruiters keep working during migration.
- [ ] Existing jobs and applicant management remain intact.

## Phase 6 — Events migration

- [ ] Free users can discover/join events.
- [ ] Draft/publish policy defined explicitly.
- [ ] Event publishing checks `event.publish` server-side.
- [ ] Event organizer verification is enforced at publish time.
- [ ] Organization event manager path supported.
- [ ] Existing hosted events remain editable by their hosts.
- [ ] Attendance flows remain unaffected.

## Phase 7 — LMS migration

- [ ] Free users can discover/enroll in permitted courses.
- [ ] Existing active mentor approval becomes trainer verification.
- [ ] Course publishing checks `course.publish` server-side.
- [ ] Organization LMS manager path supported.
- [ ] Existing mentor drafts/courses remain manageable during migration.
- [ ] Existing review/approval workflow remains intact.

## Phase 8 — Paid-plan UX

- [ ] Add `/plans` with FREE / Creator Pro / Organization Pro.
- [ ] Keep paid actions visible to Free users with clear PRO treatment rather than silently hiding them.
- [ ] Add upgrade gate for Post Job.
- [ ] Add upgrade gate for Create/Publish Event.
- [ ] Add upgrade gate for Create/Publish Course.
- [ ] Explain verification requirement separately from payment requirement.
- [ ] Add plan status to account/settings.
- [ ] Add organization billing-management entry for authorized roles.

## Phase 9 — Billing integration

- [ ] Keep entitlements provider-neutral.
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
- [ ] Preserve old identity columns during compatibility period.
- [ ] Backfill legacy creator access for existing approved recruiters.
- [ ] Backfill legacy creator access for existing active mentors.
- [ ] Preserve organization ownership/memberships.
- [ ] Migration is additive/reversible where practical.
- [ ] Schema contract tests cover new tables/columns/indexes/constraints.

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
