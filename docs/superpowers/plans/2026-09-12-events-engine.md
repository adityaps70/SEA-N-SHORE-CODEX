# Working Maritime Events Engine Implementation Plan

> Execute this plan on `feat/aws-native-phase-0-1` only. Do not touch `main`, merge, or create a PR. Preserve every AWS one-shot guard and restore all of them to `plan` after execution.

**Goal:** Replace the current presentation-only Events shell with a persistent, authenticated maritime Events product supporting event creation/management, discovery/search, RSVP, My Events, Hosting, and past-event archive on the existing Aurora/AWS architecture.

**Architecture:** Add an additive Aurora migration for `events` and `event_attendees`; isolate data access, validation and mutations under `src/features/events`; render server-first Next.js event routes inside the existing authenticated app shell; use existing `requireAwsUser`, `query`/`withTransaction`, `revalidatePath`, and guarded SSM migration/deployment workflows.

---

## Task 1: Lock behavioral contracts with failing tests

**Files:**
- Modify: `src/features/network/components/../` none
- Create: `src/features/events/events-contract.test.ts`
- Create: `src/features/events/actions.test.ts`
- Create: `scripts/aws/events-schema.test.mjs`
- Create: `scripts/aws/events-migration.test.mjs`
- Modify: `src/app/(app)/events/events-page-contract.test.ts` if present; otherwise create `src/features/events/events-page-contract.test.ts`

**Tests must require:**
- no `Coming soon` text on the Events implementation
- working links for `/events/my`, `/events/hosting`, `/events/new`
- detail/edit route source files
- create/update/cancel/attend/withdraw Server Actions authenticated through `requireAwsUser`
- event SQL migration with `public.events`, `public.event_attendees`, format/status/check constraints and indexes
- guarded migration files/workflow

Commit tests first and verify Application CI fails for missing implementation rather than test harness errors.

## Task 2: Add additive Events database schema and guarded migration

**Files:**
- Create: `infra/aws/database/migrations/0012_events_engine.sql`
- Create: `scripts/aws/events-migration-action.txt` containing `plan`
- Create: `scripts/aws/events-migration.sh`
- Create: `scripts/aws/events-migration.test.mjs`
- Create: `scripts/aws/events-schema.test.mjs`
- Create: `.github/workflows/aws-events-migration.yml`
- Modify: `.github/workflows/aws-infra-ci.yml` so Events migration/schema contracts run with the other AWS contracts if required by current workflow structure
- Modify: relevant remote execution contract test if it enumerates guarded workflows/actions

Migration must be additive/idempotent and transactionally create:
- `public.events`
- `public.event_attendees`
- published/discovery, host and attendee indexes

Guard runner must:
- bind to exact trigger SHA and expected account `310356785722`
- reject destructive SQL
- support only `plan|apply-once`
- detect already-applied/full-empty/unexpected partial schema
- execute via RDS Data API transaction
- verify final table/index shape

## Task 3: Implement Events types, validation and repository

**Files:**
- Create: `src/features/events/types.ts`
- Create: `src/features/events/validation.ts`
- Create: `src/features/events/repository.ts`
- Create/extend tests under `src/features/events/`

Repository capabilities:
- `listDiscoverEvents(viewerId, query?)`
- `listMyEvents(userId)`
- `listHostedEvents(userId)`
- `listPastEvents(viewerId, query?)`
- `getEvent(eventId, viewerId)` with visibility and meeting-link rules
- `createEvent(hostUserId, input)`
- `updateEvent(hostUserId, eventId, input)`
- `cancelEvent(hostUserId, eventId)`
- `attendEvent(userId, eventId)` transactionally enforcing published/non-cancelled/capacity and idempotency
- `withdrawAttendance(userId, eventId)`

SQL must derive authorization from server-authenticated profile IDs and never accept caller ownership IDs.

## Task 4: Implement authenticated Server Actions

**Files:**
- Create: `src/features/events/actions.ts`
- Create/complete: `src/features/events/actions.test.ts`

Actions:
- `createEventAction`
- `updateEventAction`
- `cancelEventAction`
- `attendEventAction`
- `withdrawEventAttendanceAction`

Every action validates input before mutation, calls `requireAwsUser()`, maps safe errors, and revalidates `/events`, `/events/my`, `/events/hosting`, and the affected detail/edit route.

## Task 5: Build reusable Events UI components

**Files:**
- Create: `src/features/events/components/event-nav.tsx`
- Create: `src/features/events/components/event-card.tsx`
- Create: `src/features/events/components/event-form.tsx`
- Create: `src/features/events/components/attendance-control.tsx`
- Create any small status/empty-state helpers needed

Maintain existing Sea N Shore navy/teal UI. Form supports title, summary, description, format, start/end, timezone, location, meeting URL, topics, speakers, capacity and banner URL. Create form exposes Save draft / Publish event. Edit form exposes Save changes and host-only cancellation separately.

## Task 6: Replace the Events shell with real discovery/search

**Files:**
- Replace: `src/app/(app)/events/page.tsx`
- Create: `src/app/(app)/events/my/page.tsx`
- Create: `src/app/(app)/events/hosting/page.tsx`
- Create: `src/app/(app)/events/new/page.tsx`
- Create: `src/app/(app)/events/[eventId]/page.tsx`
- Create: `src/app/(app)/events/[eventId]/edit/page.tsx`

Discovery page:
- real GET search form using `q`
- upcoming published event cards from Aurora
- format/topic links that populate search
- active nav links, not spans
- Host card links to `/events/new`
- archive section populated from past published events
- absolutely no “Coming soon” badges for implemented capabilities

Detail page:
- metadata, organizer, topics, speakers, attendee count/capacity
- Attend/Withdraw control
- meeting URL only for host/attendee
- host-only Edit and Cancel controls

## Task 7: Extend staging E2E to prove the real Events workflow

**Files:**
- Modify: `scripts/aws/onboarding-staging-e2e.mjs`
- Modify: `.github/workflows/aws-onboarding-e2e.yml` cleanup/audit SQL where needed
- Modify: `scripts/aws/onboarding-e2e-guard.test.mjs` if contract assertions need updates

Use disposable professional/custom users already created by the flow:
1. professional user creates and publishes a uniquely named event through `/events/new`
2. verify it appears in Discover search and Hosting
3. custom user discovers the event, opens detail, attends, sees it in My Events, then withdraws
4. professional user edits/cancels the event and verifies cancelled state
5. persistence audit confirms event ownership/attendance transitions
6. cleanup deletes disposable event rows before deleting disposable profiles/Cognito users
7. emit explicit markers such as `EVENTS_E2E_CREATE_VERIFIED=true`, `EVENTS_E2E_ATTENDANCE_VERIFIED=true`, `EVENTS_E2E_HOSTING_VERIFIED=true`, `EVENTS_E2E_CLEANUP_VERIFIED=true`

## Task 8: Verify application head before any AWS mutation

Run/observe exact-head:
- lint
- typecheck
- full tests
- Docker build
- Terraform validate/guard contracts
- AWS Remote Verify

Do not arm migration or deployment while any exact-head job is red or while branch moved.

## Task 9: Apply Events schema once on staging

Freshly fetch branch head and all guards. Arm only `scripts/aws/events-migration-action.txt` to `apply-once`. Wait for:
- exact-head Infrastructure CI
- AWS Events Migration success
- final schema verification markers

Immediately restore Events migration guard to `plan`, then verify exact-head CI/Remote Verify on the restore commit.

## Task 10: Deploy working Events app once

Freshly fetch branch head and all guards. Arm only `scripts/aws/staging-deploy-action.txt` to `deploy-once`. Require:
- exact-head CI gate
- immutable image build/push
- ECS deployment/stability
- exact deployed revision verification

Restore staging deploy guard to `plan` immediately after success.

## Task 11: Run authenticated disposable Events E2E once

After deployed runtime is healthy, arm only `scripts/aws/onboarding-e2e-action.txt` to `run-once`. Require all Events-specific markers, persistence checks and cleanup checks to pass. Restore onboarding guard to `plan` immediately afterward.

## Task 12: Final safety closeout

Read `verification-before-completion` skill. Re-fetch live branch and every relevant guard, including:
- staging deploy
- onboarding E2E
- events migration
- edge recovery
- organization hiring E2E
- hiring create-job probe

All must be `plan`. Require final exact-head Infrastructure CI and Remote Verify success. Only then report the Events engine complete and enumerate exactly what is live.
