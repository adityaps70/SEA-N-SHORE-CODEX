# Sea N Shore Native LMS Implementation Plan

> **Scope:** Build the LMS natively inside the existing authenticated Sea N Shore app on `feat/aws-native-phase-0-1`. Reuse Cognito, Aurora PostgreSQL, S3/CloudFront, existing application UI, platform-admin authorization, audit events and the guarded AWS migration/deployment model. Do not introduce Edmingle, iframe delivery, separate authentication, Supabase, a separate academy app, or automated payouts in the foundation phase.

## Repository-grounded architecture

- Keep `/learn` as the Learning root. The current route is only a product preview, so replace it incrementally with native workflows instead of creating a competing top-level route.
- Add a dedicated `src/features/learning/` domain with feature-local schemas, workflow/permission helpers, repositories, server actions, queries, components and tests, matching the patterns used by organizations/jobs/admin.
- Authentication: use existing Cognito `requireUser()` / `requireAwsUser()`; learner = any signed-in Sea N Shore user.
- Mentor authorization: require an active approved row in `public.learning_mentors`; application approval is transactional and auditable.
- Learning admin: reuse existing `public.user_roles.role = 'administrator'` platform-admin authorization initially. Do not add a second LMS admin identity model.
- Data access: direct PostgreSQL through `src/lib/db/client.ts`, with row locks and transactions for review/enrollment/progress transitions.
- Assets: reuse the existing `AWS_MEDIA_BUCKET` S3 helpers. Course objects live under a `learning/` keyspace. Upload/read URLs are only issued after ownership/enrollment checks; object metadata is verified before a lesson references an upload.
- Schema changes: additive Aurora SQL under `infra/aws/database/migrations/`, executed only through a new exact-head/account-locked `scripts/aws/learning-foundation-migration.sh` with a default `plan` guard and contract tests. Never run raw production/staging SQL from the app.
- Audit: mentor and course review decisions write to existing `public.audit_events`. EventBridge/outbox integration can be added when enrollment/payment/certificate events need asynchronous consumers.
- Commerce boundary: Phase 1 supports free enrollment. Paid course metadata can exist, but paid enrollment is not activated until Razorpay/order/payment verification exists in Phase 2.

## Phase 1 — LMS Foundation

### Task 1A — Domain workflows, permissions, schema, mentor approval

**Files:**
- Create `src/features/learning/course-workflow.test.ts`
- Create `src/features/learning/course-workflow.ts`
- Create mentor application schema/types/repository/action tests and implementations under `src/features/learning/`
- Create `infra/aws/database/migrations/0015_learning_foundation.sql` (use the next live migration number after rechecking the repository)
- Create `scripts/aws/learning-foundation-migration-action.txt` with `plan`
- Create migration/schema guard tests and migration runner
- Add the new contract tests to `.github/workflows/aws-infra-ci.yml`

**Behavior:**
- Course workflow is explicit: mentor `draft -> submitted`, mentor `changes_requested -> submitted`; admin `submitted -> changes_requested|approved`; admin `approved -> published`; admin `published -> archived`.
- Mentors can edit course content only in `draft` or `changes_requested` initially.
- Mentor applications capture maritime rank/experience/vessel types/specialization/certifications/LinkedIn/bio/photo/proposed topics.
- Only platform admins can approve/reject/request changes.
- Approval creates/activates `learning_mentors` transactionally and writes an audit event.

### Task 1B — Course authoring and admin course review

**Files/routes:**
- `src/features/learning/course-repository.ts` + tests
- `src/features/learning/actions.ts` + tests
- `/learn/teach`
- `/learn/studio`
- `/learn/studio/courses`
- `/learn/studio/courses/new`
- `/learn/studio/courses/[courseId]/edit`
- `/admin/learning/mentors`
- `/admin/learning/courses`

**Behavior:**
- Approved mentors create/update owned courses only.
- Course fields cover title/subtitle/description/category/level/language/thumbnail/trailer/learning outcomes/requirements/target audience/free-vs-paid/price metadata/certificate flag.
- Builder supports ordered sections and lessons. Initial lesson model supports all requested lesson kinds as typed records, while heavy assessment behavior remains Phase 3.
- Mentor cannot approve or publish their own course.
- Admin review uses row locks, explicit transitions and audit events.

### Task 1C — Marketplace, course detail, free enrollment, My Learning

**Routes:**
- `/learn` — Explore marketplace
- `/learn/my-learning`
- `/learn/live`
- `/learn/mentors`
- `/learn/certificates`
- `/learn/courses/[slug]`

**Behavior/UI:**
- Premium maritime marketplace using existing Sea N Shore tokens/components, not generic LMS admin styling.
- Primary Learning nav: Explore, My Learning, Live, Mentors, Certificates.
- Categories: Deck, Engine, Tankers, LNG/LPG, Offshore, SIRE 2.0, Safety, Maritime Law, Leadership, Human Factors, Shore Careers, Mental Health, Exams & Assessments.
- Only `published` courses appear in discovery.
- Free courses can enroll immediately and idempotently.
- Paid courses show purchase intent but cannot create an active enrollment before Phase 2 payment verification.

### Task 1D — Learner player, assets and progress

**Routes:**
- `/learn/my-learning/[courseId]` (or stable course-slug equivalent chosen after repository implementation)

**Behavior:**
- Server verifies active enrollment before returning protected lesson data or presigned asset URLs.
- Player layout: curriculum left, lesson content center, Notes/Q&A secondary affordance; Notes/Q&A can start as non-persisted/disabled affordances until their dedicated persistence slice.
- Persist lesson completion, last playback position and enrollment progress server-side.
- Progress writes are idempotent and ownership-enforced.
- Resume points survive devices/sessions.

## Phase 2 — Commerce

- Add Razorpay dependency/integration only when this phase begins.
- Introduce orders, items, payments, coupons and mentor earning ledger with integer minor units and explicit currency.
- Verify Razorpay webhook signatures server-side before enrollment activation.
- Platform commission is configurable data/config, never hard-coded in transaction logic.
- Mentor payouts remain manual but ledgered and auditable.

## Phase 3 — Assessments & Certificates

- MCQ, multiple-select, true/false, scenario, written response and assignment/file submission.
- Attempts, passing score, timer, attempt limits, randomization/question banks and answer-visibility settings.
- Completion rules issue immutable certificate credentials with unique ID, QR verification and public `/certificate/<credential>` route.
- Add-to-Maritime-Passport uses the existing profile/passport domain rather than duplicating credentials.

## Phase 4 — Creator Marketplace

- Verified-enrollment reviews, mentor analytics, earnings/payout screens, coupons, enhanced mentor profiles and Zoom/Google Meet live/hybrid sessions.
- Manual payout workflow first; automated settlement remains later.

## Explicitly deferred

Subscriptions, AI Tutor, SCORM/xAPI, DRM, automated payouts, advanced cohort automation and advanced analytics.

## Verification discipline

For every meaningful behavior: write the test first, confirm the AWS-native branch CI fails for the intended missing/incorrect behavior, implement the smallest production change, then require the exact-head AWS Infrastructure CI to be green before calling the slice complete. Keep all one-shot deployment/migration guards at `plan` unless a separately authorized, exact-head apply/deploy is intentionally armed and immediately restored.
