# Sea N Shore Realtime Messaging & Community Groups Implementation Plan

> **For agentic workers:** Implement task-by-task with test-driven development. Re-fetch the live `feat/aws-native-phase-0-1` head before every repository write because this branch can move concurrently.

**Goal:** Build a Sea N Shore-owned LinkedIn-style 1-to-1 messaging product on AWS-managed realtime infrastructure, then turn the existing Community placeholder into professional Groups that reuse the mature social feed engine.

**Architecture:** Aurora PostgreSQL remains the authoritative store for conversations, messages, read state, groups, memberships, and group posts. Durable messaging writes go through the existing Next.js/Aurora transaction boundary and enqueue domain events into the existing transactional outbox; WebSockets are a delivery layer, never the source of truth. Amazon API Gateway WebSocket API provides managed persistent connections. A small authenticated realtime handler layer stores ephemeral connection records in DynamoDB with TTL, forwards typing/read/delivery events, and pushes committed domain events to connected clients. Existing EventBridge/SQS infrastructure is reused for durable event fanout. Groups are a dedicated domain for membership, permissions, discovery, and moderation, while existing Feed posts/comments/reactions/media/polls/mentions are reused via an optional `group_id` context.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, PostgreSQL/Aurora, `pg`, Amazon API Gateway WebSocket API, AWS Lambda, DynamoDB on-demand, EventBridge, SQS, ECS/Fargate, Cognito-backed Sea N Shore identity, Terraform, GitHub Actions, Vitest, Playwright.

## Global Constraints

- Work only on `feat/aws-native-phase-0-1`.
- Never touch `main`, merge, create a PR, reset, or force-push.
- Re-fetch live branch head immediately before every create/update/delete write.
- Preserve existing Feed, Network, Notifications, Jobs, Events, media upload, Cognito, Aurora, ECS, CloudFront and staging behavior.
- Correct AWS account is `310356785722`; never use `992382634586`.
- WebSocket is delivery only. A message is realtime-deliverable only after its Aurora transaction commits.
- One authenticated app-level socket per signed-in browser session serves messaging and future realtime events; do not create per-feature sockets.
- Do not send attachments through WebSocket. Future attachments use presigned S3 upload/download.
- Do not persist typing or transient presence in Aurora.
- Do not log message bodies, typing events, or every socket frame in CloudWatch.
- Exact-head CI must be green before any staging migration or deploy.
- All AWS/database mutations use existing guarded workflows or a new guard modeled on the repository's guarded workflows; no ad-hoc staging SQL/Terraform apply.
- At-least-once delivery is expected; durable consumers and client handling must be idempotent.

## Product Scope — Messaging V1

- `/messages` desktop two-pane inbox/thread experience; mobile thread opens full screen.
- Direct conversations only in V1.
- Start messaging from accepted Network connections and supported profile/network surfaces.
- Conversation search, recent-message preview, unread count, optimistic send, emoji-capable text, timestamps, delivered/realtime state, read receipts, typing indicator, reconnect/offline history.
- Main navigation Messages entry with unread badge.
- Normal member initiation requires an accepted connection; service boundary stays extensible for future recruiter/applicant exceptions.
- No group chat rooms, voice/video calling, attachments, message search, reactions, edit/delete, push notifications, or E2EE in the first slice unless added explicitly in a later task.

## Product Scope — Groups V1

- Real `/community` dashboard plus `/community/groups`, `/community/groups/[slug]`, members and management surfaces.
- Public groups join immediately; private groups create pending membership requests.
- Roles: OWNER, ADMIN, MODERATOR, MEMBER. States: ACTIVE, PENDING, BANNED.
- Existing social Feed engine powers group text/media posts, polls, mentions, comments/replies, reactions and shares.
- Group administration: approve membership, remove/ban member, role promotion/demotion within safe hierarchy, pin/unpin posts, delete group content where authorized.
- Private-group posts never leak into global/public feed queries for unauthorized viewers.
- V1 Groups are discussion feeds, not realtime chat rooms.

---

## Task 1: Lock the messaging schema contract with RED tests

**Files:**
- Create: `src/features/messaging/schemas.test.ts`
- Create: `src/features/messaging/repository.test.ts`
- Create: `src/features/messaging/service.test.ts`
- Create: `scripts/aws/messaging-schema.test.mjs`

**Behavior contracts:**
- Direct-conversation participant pairs are canonical/unique.
- Only participants may list/read/send/mark-read in a conversation.
- Starting a direct conversation requires an accepted Network connection and no block in either direction.
- Sending supports a client-generated idempotency key (`clientMessageId`) so reconnect/retry cannot create duplicate messages.
- Messages paginate by stable `(created_at, id)` cursor and return chronological thread display ordering.
- Participant read state advances monotonically and supports an unread conversation count without per-message receipt rows.
- Message body is bounded and normalized; empty/whitespace-only body is rejected.

- [ ] Write failing Vitest contracts against the proposed messaging interfaces.
- [ ] Write a failing migration contract that expects the next available migration to define `conversations`, `conversation_participants`, `messages`, participant uniqueness, message idempotency, indexes for inbox/thread queries, and read state.
- [ ] Run only the new tests and verify RED is caused by missing messaging implementation, not syntax/configuration problems.
- [ ] Commit the RED tests alone.

## Task 2: Add the messaging database migration

**Files:**
- Create: `infra/aws/database/migrations/<next>_messaging.sql` after re-checking the live migration directory immediately before write.
- Modify AWS infra CI only if existing migration-contract discovery does not automatically cover the new test.

**Schema:**

```sql
conversations(
  id uuid primary key,
  type text not null check (type = 'direct'),
  direct_user_low_id uuid,
  direct_user_high_id uuid,
  last_message_id uuid,
  last_message_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
)

conversation_participants(
  conversation_id uuid not null,
  profile_id uuid not null,
  joined_at timestamptz not null,
  last_read_message_id uuid,
  last_read_at timestamptz,
  muted_at timestamptz,
  archived_at timestamptz,
  primary key (conversation_id, profile_id)
)

messages(
  id uuid primary key,
  conversation_id uuid not null,
  sender_profile_id uuid not null,
  client_message_id uuid not null,
  body text not null,
  created_at timestamptz not null,
  edited_at timestamptz,
  deleted_at timestamptz,
  unique(sender_profile_id, client_message_id)
)
```

Add exact foreign keys/checks/indexes after inspecting current profile/table naming. Use canonical low/high IDs and a unique direct-pair constraint so two simultaneous starters cannot create duplicate conversations.

- [ ] Add migration.
- [ ] Run messaging schema contract GREEN.
- [ ] Run existing database/migration contract suite.
- [ ] Commit schema independently.

## Task 3: Implement the messaging repository and service transaction boundary

**Files:**
- Create: `src/features/messaging/types.ts`
- Create: `src/features/messaging/schemas.ts`
- Create: `src/features/messaging/repository.ts`
- Create: `src/features/messaging/service.ts`
- Modify: `src/features/events/types.ts`
- Reuse: `src/features/events/outbox-repository.ts`
- Use: `src/features/network/repository.ts` / service-compatible accepted-connection and block checks.

**Interfaces:**
- `startDirectConversation(actorId, targetId)` returns existing or newly created conversation.
- `sendMessage(actorId, { conversationId, clientMessageId, body })` writes one message, updates conversation last-message metadata, then enqueues `message.created` in the same DB transaction.
- `markConversationRead(actorId, conversationId, messageId)` advances participant read state only if message belongs to that conversation and is not older than current read marker.
- Repository list methods support inbox and cursor-paginated thread history.

**Domain event extension:**
- `message.created` payload includes only routing-safe metadata required by consumers: event type, conversation ID, message ID, sender ID, recipient profile IDs, occurredAt. Do not put message body into EventBridge/SQS/CloudWatch event payload unless an explicit delivery requirement proves it necessary; realtime recipient can fetch/receive a sanitized message DTO from the originating application path.
- `message.read` durable event only if needed for cross-device/read delivery; otherwise publish a lightweight realtime command after read state commits.

- [ ] Implement minimal repository/service until RED service tests pass.
- [ ] Verify transaction rollback prevents both message and outbox event on failure.
- [ ] Verify duplicate `clientMessageId` returns the same persisted message semantics rather than inserting twice.
- [ ] Commit domain/service GREEN.

## Task 4: Add authenticated messaging queries and server actions

**Files:**
- Create: `src/features/messaging/queries.ts`
- Create: `src/features/messaging/actions.ts`
- Create tests beside them.

**Behavior:**
- All entry points derive the actor from `requireAwsUser()`; never accept actor profile ID from the browser.
- `getConversationInbox()` returns other participant identity/avatar/headline, last message preview/time and unread state.
- `getConversationThread()` rejects nonparticipants.
- `startDirectConversationAction()` validates target UUID and permission.
- `sendMessageAction()` returns the canonical message DTO for optimistic reconciliation.
- `markConversationReadAction()` persists read state and is safe to repeat.
- Safe error messages; no raw DB/AWS details exposed.

- [ ] Write RED action/query tests.
- [ ] Implement minimal GREEN.
- [ ] Commit.

## Task 5: Build the LinkedIn-style Messaging UI before realtime

**Files:**
- Create: `src/app/(app)/messages/page.tsx`
- Create: `src/app/(app)/messages/[conversationId]/page.tsx` if route-based mobile/thread state is cleaner after inspection.
- Create: `src/features/messaging/components/message-shell.tsx`
- Create: `src/features/messaging/components/conversation-list.tsx`
- Create: `src/features/messaging/components/message-thread.tsx`
- Create: `src/features/messaging/components/message-composer.tsx`
- Create component/contract tests.
- Modify exact current navigation/profile/network component paths only after re-fetching them.

**UX:**
- Premium Sea N Shore design, not a generic messenger clone.
- Desktop inbox + active thread; responsive mobile inbox/thread navigation.
- Empty states, loading/pending states, failed-send retry, date separators, own/other message treatment, scroll-to-latest on initial open, sensible history loading.
- Optimistic send uses `clientMessageId`, then reconciles returned canonical ID/time.
- Message button on eligible professional profiles/network cards.
- Main app navigation gets Messages icon and unread badge.

- [ ] RED UI contract tests.
- [ ] Build UI using current server actions with no WebSocket dependency yet so durable messaging is independently testable.
- [ ] GREEN UI tests + accessibility assertions where current test patterns support them.
- [ ] Commit.

## Task 6: Design and test the app-level realtime client contract

**Files:**
- Create: `src/features/realtime/types.ts`
- Create: `src/features/realtime/client.ts`
- Create: `src/features/realtime/realtime-provider.tsx`
- Create tests.
- Modify: `src/app/(app)/layout.tsx` only after exact-head re-fetch.

**Client behavior:**
- One socket for the authenticated app shell.
- Explicit states: connecting, connected, reconnecting, offline.
- Exponential reconnect with jitter and a cap; no reconnect storm.
- Heartbeat only if required by API Gateway/client lifecycle, not high-frequency noise.
- Typed event dispatch for `message.new`, `message.read`, `message.typing`, `notification.new`; future events extend the union.
- Deduplicate `message.new` by message ID.
- `message.typing` is throttled client-side (target ~2 seconds) and expires locally.
- Hidden/offline tabs do not create redundant sockets; multi-tab behavior is documented and bounded.

- [ ] RED provider/client tests with mocked WebSocket.
- [ ] Implement browser client independent of AWS endpoint value.
- [ ] GREEN tests and commit.

## Task 7: Add AWS-managed WebSocket infrastructure with Terraform contracts

**Files:**
- Prefer Create: `infra/aws/app/realtime.tf` inside the existing Terraform root after confirming current file organization.
- Create handler source in the repository's established AWS script/runtime location after inspection; do not invent a second deployment convention.
- Modify: `package.json` / lockfile only for required AWS SDK clients.
- Add focused infra contract tests under `scripts/aws/` and wire into `.github/workflows/aws-infra-ci.yml` if necessary.

**Resources:**
- API Gateway v2 WebSocket API and stage.
- Routes: `$connect`, `$disconnect`, `typing` initially; avoid durable `sendMessage` route because durable sends stay through authenticated app/Aurora transaction.
- Authenticated `$connect`: validate the existing Cognito/session token using the platform's actual auth model; do not create custom identity/JWT logic.
- DynamoDB connection registry, PAY_PER_REQUEST, TTL enabled. Schema must support efficient `profileId -> connectionIds` fanout and `connectionId -> record` disconnect cleanup.
- Lambda handlers for connect/disconnect/ephemeral typing as needed.
- Least-privilege IAM for registry access and `execute-api:ManageConnections`.
- CloudWatch logs with short/appropriate retention and no message-body/typing-frame logging.
- CloudWatch metrics/alarms for 5xx/handler errors/throttling where practical in the existing Terraform style.
- Output the WSS endpoint for application runtime configuration.

- [ ] RED Terraform/source contract tests asserting API Gateway, DynamoDB TTL, least-privilege policy shape, required routes and logging restrictions.
- [ ] Implement Terraform/handler minimum.
- [ ] `terraform fmt -check` and existing Terraform validate/guard CI must pass.
- [ ] Commit infra without applying it.

## Task 8: Deliver committed `message.created` events to active sockets

**Files:**
- Extend the existing event/outbox consumer path rather than creating a parallel durable-event architecture.
- Likely modify current outbox/event worker or add a narrowly scoped realtime consumer after inspecting `.github`, `scripts/workers`, EventBridge rules and SQS targets at the then-live head.
- Create `src/features/realtime/delivery.ts` or worker-equivalent plus tests if application code owns API Gateway Management API calls.

**Delivery behavior:**
- `message.created` event identifies recipient profile(s).
- Resolve recipient connection IDs from DynamoDB.
- Push typed `message.new` envelope to each active connection.
- HTTP 410/Gone from API Gateway deletes stale connection record and is not retried forever.
- One bad/stale device cannot prevent delivery to another device.
- Durable event consumer remains idempotent.
- Sender's other devices may receive the canonical `message.new` for multi-device synchronization.
- Offline recipients simply receive the message from Aurora when they next load; WebSocket delivery failure does not roll back persisted message.

- [ ] RED delivery tests, including stale connection cleanup and multi-device fanout.
- [ ] Implement GREEN.
- [ ] Commit.

## Task 9: Wire realtime behavior into Messaging

**Files:**
- Modify messaging components/provider integration with tests.

**Behavior:**
- Active thread appends `message.new` instantly and reconciles optimistic message IDs.
- Inbox updates preview/time/order and unread state without full page refresh.
- Navigation unread badge changes live.
- Opening/reading a conversation persists read marker and sends `message.read` to other active participant devices after commit.
- Typing event only emitted for active direct conversation, throttled; receiver expires indicator after short inactivity.
- Reconnect fetches authoritative inbox/thread delta from HTTP/Aurora; socket is not trusted to fill missed history.

- [ ] RED integration tests.
- [ ] GREEN implementation.
- [ ] Commit.

## Task 10: Add messaging notifications without duplicate delivery

**Files:**
- Extend `src/features/notifications/event-consumer.ts`, types/repository/tests as appropriate.

**Behavior:**
- `message.created` can create an in-app notification only when product UX requires one outside the dedicated unread Messages badge; avoid double-notifying an actively open thread.
- Existing notification idempotency/event-receipt pattern is reused.
- Do not store message body in notification logs/events; preview can be loaded safely or intentionally omitted.

- [ ] RED notification consumer tests.
- [ ] Implement minimal product behavior.
- [ ] Commit.

## Task 11: Add Groups schema and domain with TDD

**Files:**
- Create next-live-number database migration, expected conceptually `<next>_community_groups.sql`.
- Create: `src/features/groups/types.ts`
- Create: `src/features/groups/schemas.ts`
- Create: `src/features/groups/repository.ts`
- Create: `src/features/groups/service.ts`
- Create: `src/features/groups/queries.ts`
- Create: `src/features/groups/actions.ts`
- Create tests for each boundary.

**Schema/permissions:**
- `groups`: id, slug, name, description, category, visibility, logo/cover storage keys, rules, owner, timestamps.
- `group_members`: group/profile composite key, role, status, joined timestamp and moderation timestamps.
- Add nullable `group_id` to posts plus indexes/FK.
- Add group pin/announcement representation using the smallest normalized model that satisfies V1 after inspecting existing post schema.
- Public join -> ACTIVE; private join -> PENDING.
- OWNER cannot be accidentally removed/demoted without explicit ownership transfer semantics; V1 may simply disallow owner removal.
- Blocked/banned users cannot post or access private content.

- [ ] RED schema/domain tests.
- [ ] Implement migration and domain GREEN.
- [ ] Commit in small schema then service slices.

## Task 12: Reuse Feed safely inside Groups

**Files:**
- Modify: `src/features/feed/types.ts`, `schemas.ts`, `repository.ts`, `queries.ts`, `service.ts`, actions and tests as needed.
- Reuse current post composer/card/comment/reaction/media components rather than fork them.

**Critical isolation contracts:**
- Group post creation requires active membership and records `group_id` transactionally.
- Private-group content is unavailable to nonmembers at repository/query level, not merely hidden in UI.
- Global/home feed never exposes private group posts.
- Decide explicitly whether public-group posts can appear in global feed; default V1 is group-context only unless product ranking explicitly adds them.
- Existing non-group post behavior is unchanged.
- Comments/reactions/mentions/media work unchanged on authorized group posts.

- [ ] Write isolation/security RED tests before changing Feed SQL.
- [ ] Extend repository/query/service minimally.
- [ ] Run full Feed suite plus new Groups integration tests.
- [ ] Commit.

## Task 13: Replace Community placeholder with professional Groups UX

**Files:**
- Replace: `src/app/(app)/community/page.tsx`
- Create: `src/app/(app)/community/groups/page.tsx`
- Create: `src/app/(app)/community/groups/[slug]/page.tsx`
- Create: `src/app/(app)/community/groups/[slug]/members/page.tsx`
- Create: `src/app/(app)/community/groups/[slug]/manage/page.tsx`
- Create: `src/features/groups/components/*`
- Tests first.

**Community dashboard:**
- Your Groups
- Discover Groups
- Trending Discussions
- Recommended Groups
- Create Group

**Initial categories:** Tanker Professionals, Marine Engineers, Masters & Senior Officers, Cadets, Maritime HR & Crewing, Shore Professionals, SIRE/Vetting, LNG/LPG, Offshore, Mental Health & Welfare, Maritime Entrepreneurs, Women in Maritime.

**Group page:** professional cover/header, logo, visibility, description, rules, member count, join/request state, admins, pinned content and the reused feed composer/list.

- [ ] RED route/component contracts.
- [ ] GREEN responsive implementation.
- [ ] Commit.

## Task 14: Add Groups moderation and membership management

**Behavior tests first:**
- Private join approval/rejection.
- Remove/ban/unban member.
- Promote/demote within hierarchy.
- Moderator/admin post removal and pin/unpin.
- Nonmoderator cannot perform moderation actions.
- Group-level actions cannot override platform-level blocks/admin safety.

- [ ] RED permission matrix tests.
- [ ] Implement repository/service/action checks.
- [ ] Build management UI.
- [ ] GREEN and commit.

## Task 15: Add cost/operations guardrails for realtime

**Infrastructure/observability:**
- Metrics for active connections, connect/disconnect errors, Lambda failures/throttles, realtime delivery failures, stale-connection removals and message send latency.
- DynamoDB on-demand and TTL; no provisioned overcapacity.
- Avoid high-cardinality per-user metrics.
- Production logging excludes message body and typing payloads.
- If repository deployment role has safe support for AWS Budgets Terraform, add alert thresholds; otherwise document budget setup as an explicit ops follow-up rather than widening IAM casually.
- Establish a simple dashboard/query for realtime cost drivers rather than logging every event.

- [ ] RED infra/logging contracts where automatable.
- [ ] Implement minimal safe metrics/alarms.
- [ ] Commit.

## Task 16: Staging migration, infrastructure rollout, E2E and application deploy

Before every AWS mutation:
- Re-fetch exact branch head.
- Confirm correct account `310356785722` and existing staging deploy role.
- Audit all existing mutation guards are exact `plan\n`.
- Inspect current migration workflow/guard and add a dedicated messaging/groups/realtime guard only if existing generalized workflow cannot safely execute these changes.

**Required verification flow:**
1. Exact-head AWS Infrastructure CI green: lint, typecheck, unit/integration contracts, Docker build, Terraform validate/plan guards.
2. Apply database migration through the repository's guarded migration mechanism; verify schema and no destructive statements.
3. Apply realtime Terraform through the existing guarded AWS workflow/narrow plan mechanism; verify WebSocket API, Lambda, DynamoDB, IAM, logs and stage endpoint in account `310356785722`.
4. Run a staging realtime diagnostic with two authenticated test users/devices: connect, start allowed conversation, send, receive instantly, retry same client message ID without duplicate, type indicator, mark read, disconnect/reconnect, offline-history recovery, block/access denial.
5. Deploy web app once using `scripts/aws/staging-deploy-action.txt = deploy-once` only after exact-head CI is green.
6. Verify ECS rollout/image identity/runtime health and user-facing `/messages` + Community routes.
7. Restore every one-time guard to exact `plan\n`.
8. Confirm restore-triggered workflows skip actual mutation/deploy.
9. Run final exact-head AWS Infrastructure CI + AWS Remote Verify.
10. Final guard audit: all mutation/deployment guards exact `plan\n`.

## Task 17: Follow-up realtime feed invalidation after Messaging/Groups are stable

This is intentionally after core Messaging/Groups V1.

- Replace the current 30-second full `loadFeedPage()` refresh with `feed.new_posts` realtime invalidation.
- WebSocket sends only lightweight change metadata/count; actual posts remain HTTP/Aurora responses.
- Reconnect/fallback can use a cheap head/version check rather than full feed hydration.
- Preserve cursor pagination and existing new-post banner UX.
- Add hidden-tab/backoff/jitter fallback behavior so absence of WebSocket never creates a thundering herd.

## Completion Evidence Required

Do not call this project complete until evidence shows:
- Durable message transaction + outbox behavior is tested.
- Unauthorized conversation/group access is denied at service/repository boundaries.
- WebSocket reconnect/offline behavior is tested.
- No duplicate message on retry.
- Realtime staging delivery works across two authenticated clients.
- Private Groups do not leak content.
- Full existing Feed/Network/Notifications/Jobs/Events suites remain green.
- Terraform plan/validate and AWS account checks pass.
- Final staging ECS runtime is healthy.
- All mutation guards are restored to `plan`.
