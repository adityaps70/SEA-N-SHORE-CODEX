# Sea N Shore Website Quality Pass Implementation Plan

> Execute on `feat/aws-native-phase-0-1` only. Re-fetch the live branch head before every write. Use TDD and exact-head verification. Do not touch `main`, merge, create a PR, force-push, or reset.

## Task 1 — Lock existing username behavior and repair profile completeness

**Files:**
- `src/features/feed/profile-completion.ts`
- `src/features/feed/profile-completion.test.ts`
- `src/features/feed/components/feed-profile-card.tsx`
- `src/features/feed/components/feed-profile-card.test.tsx`
- `src/app/(app)/home/page.tsx`
- `src/features/profiles/profile-portfolio-queries.ts`
- existing onboarding/profile username tests under `src/app/(app)/onboarding` and `src/app/(app)/profile`

**Steps:**
1. Add regression assertions for realtime username availability, `@username` display, and the two-edit limit without changing the already-working implementation.
2. Add failing tests proving Experience and Credentials contribute to completion for maritime profiles.
3. Extend the completion input contract to include portfolio evidence and return both percentage and missing sections where useful.
4. Load portfolio summary on Home and pass it into the feed profile card/rail.
5. Show a concise next missing step when completion is below 100%.
6. Run focused tests, then commit.

## Task 2 — First-party feed media URLs

**Files:**
- `src/features/feed/queries.ts`
- feed media helpers/repository files discovered during implementation
- `src/app/(app)/api/...` new same-origin media route if required
- corresponding feed/media tests

**Steps:**
1. Add a failing contract test that feed browser URLs do not expose the S3 bucket hostname.
2. Introduce a same-origin authenticated/read-safe media route that resolves approved post media from private S3 while preserving MIME/range/cache semantics as needed.
3. Change feed reads to emit `/api/...` or first-party CloudFront URLs instead of presigned S3 GET URLs.
4. Keep direct S3 presigned PUT uploads unchanged unless required.
5. Run focused tests and commit.

## Task 3 — Global search and notification clarity

**Files:**
- `src/components/navigation/app-header.tsx`
- app-header tests
- new `src/app/(app)/search/page.tsx` and tests
- search repositories/adapters for People, Jobs, Learning, Events
- `src/features/notifications/components/notification-list.tsx`
- `src/features/notifications/components/notification-bell.tsx`
- notification component tests

**Steps:**
1. Add RED tests for retained global query and People/Jobs/Courses/Events result groups.
2. Replace people-only header form with `/search?q=...` and a global placeholder/label.
3. Build a server-rendered global result page using existing repositories and safe bounded result counts.
4. Strengthen unread notification row/bell semantics using visible `Unread` treatment, stronger typography/background, and `aria-label`/state without changing read actions.
5. Run focused tests and commit.

## Task 4 — Post composer resilience and semantics

**Files:**
- `src/features/feed/components/post-composer.tsx`
- post composer tests
- `src/features/feed/actions.ts`
- `src/features/feed/schemas.ts`
- feed types/repository if durable metadata needs persistence
- bounded migration only if existing schema cannot store required durable metadata

**Steps:**
1. RED-test audience, post type, topic tags, character count, Question mode, and local draft restoration.
2. Add Anyone / Connections / Community audience controls.
3. Add Update / Question / Technical poll type control; route “Ask community” into Question mode.
4. Add topic tags and character counter.
5. Persist the text/type/tag/audience draft locally while editing and restore after reconnect/reload; clear only after successful post or explicit discard.
6. Persist durable metadata only where the current feed schema already supports it; otherwise add one bounded migration with guarded migration tooling.
7. Run focused tests and commit.

## Task 5 — Network relationship action cleanup and demo/test identity hygiene

**Files:**
- `src/app/(app)/network/page.tsx`
- `src/app/(app)/network/page.test.tsx`
- `src/app/(app)/network/components/NetworkConnectionCard.tsx`
- `src/app/(app)/network/components/NetworkConnectionCard.test.tsx`
- `src/app/(app)/network/components/MoreMenu.tsx`
- `src/features/network/queries.ts`
- network tests

**Steps:**
1. RED-test one-primary-action states: Connect, Pending, Message.
2. Move secondary relationship actions into More while keeping state as quiet text/badge.
3. Add safe filtering/visibility rules so demo/E2E/test accounts do not appear in production discovery/recommendations.
4. Prefer durable test/non-public markers where already available; avoid brittle display-name-only filtering except as backward-compatible cleanup defense.
5. Run focused tests and commit.

## Task 6 — Messaging compose flow and inbox row quality

**Files:**
- `src/features/messaging/components/message-shell.tsx`
- message-shell tests
- messaging queries/repository/types
- `src/app/(app)/messages/page.tsx`

**Steps:**
1. RED-test New message CTA/recipient picker, participant role/company subtitle, last-message preview, avatar fallback, and unread styling.
2. Reuse accepted connections/authorized conversation creation path for recipient discovery.
3. Add compose interaction without weakening participant authorization.
4. Enrich inbox DTO only with fields already public/authorized to the viewer.
5. Run focused tests and commit.

## Task 7 — Jobs filters, sort semantics and empty states

**Files:**
- `src/app/(app)/jobs/page.tsx`
- `src/app/(app)/jobs/page.test.tsx`
- new client filter/sort component if needed
- existing jobs query helpers/repository

**Steps:**
1. RED-test auto-applied filters, active chips, clear-all, collapsed advanced filters, result count, and Best match/Newest/Salary captions.
2. Convert filters to URL-backed client controls that update the query automatically.
3. Render removable active filter chips and `N filters · Clear all`.
4. Keep advanced controls collapsed by default.
5. Add explicit sort control and correct per-mode description.
6. Distinguish zero inventory from zero filtered matches and show useful CTAs.
7. Run focused tests and commit.

## Task 8 — Events/profile empty states

**Files:**
- `src/app/(app)/events/page.tsx` and tests
- profile timeline/credential components and tests

**Steps:**
1. RED-test empty-vs-filtered event archive states.
2. Offer Host event / Clear filters / Browse upcoming action as context demands.
3. Make empty Experience and Credential profile sections lead directly to add/edit actions with constructive copy.
4. Run focused tests and commit.

## Task 9 — Learn marketplace card quality and E2E fixture isolation

**Files:**
- `src/app/(app)/learn/page.tsx`
- `src/app/(app)/learn/page.test.tsx`
- `src/features/learning/marketplace-repository.ts`
- marketplace repository tests
- `scripts/aws/learning-assignment-review-staging-e2e.mjs`
- `scripts/aws/learning-assignment-review-hide-fixture-ssm.mjs`
- related guard tests

**Steps:**
1. RED-test public catalog exclusion of E2E/test fixtures and count consistency.
2. Harden repository visibility so the same filtered set drives cards and count.
3. Harden staging E2E fixture lifecycle to make test mentor/course non-public or clean them up after verification.
4. Change category strip to wrapping/no truncation/no raw horizontal scrollbar.
5. Enrich cards with available level, format, certificate, lesson count, duration when derivable, unique visual/fallback, and explicit Start/Continue CTA.
6. Run focused tests and commit.

## Task 10 — Authenticated trust/legal shell

**Files:**
- `src/app/(app)/layout.tsx`
- new shared footer/trust links component and tests
- About / verification / employers / help / contact / terms / privacy destination pages where missing

**Steps:**
1. RED-test sitewide trust links and real destinations.
2. Add compact LinkedIn-style right-rail/bottom footer behavior appropriate to available width without obstructing page content.
3. Create concise real pages for all destinations, reusing existing public/legal copy when present.
4. Run focused tests and commit.

## Task 11 — Full verification, migration/deploy and live smoke

1. Re-fetch exact feature head.
2. Require full AWS Infrastructure CI green at that exact head.
3. If a new migration was required, run only its dedicated guarded migration path and immediately restore its guard to `plan`; never rerun `0023_profile_username.sql`.
4. Confirm `scripts/aws/staging-deploy-action.txt` is `plan`.
5. Re-fetch head and arm staging deployment once.
6. Wait for terminal deploy success/failure.
7. Immediately re-fetch head and restore deployment guard to `plan` before reading detailed deploy logs.
8. Require full CI green on the restoration head.
9. Run bounded live staging smoke checks for public and authenticated paths available via existing test-user/remote verification patterns.
10. Report exact commits, workflow runs, ECS/image evidence, guard state, and any runtime path that could not be authenticated rather than inventing evidence.
