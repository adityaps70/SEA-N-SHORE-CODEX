# Realtime Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add realtime direct messaging with instant incoming messages, live Sent -> Seen updates, live inbox/unread refresh, safe reconnect/catch-up, and AWS-managed websocket fan-out while Aurora remains canonical.

**Architecture:** Canonical writes stay in Next.js/ECS + Aurora transactions. Existing `event_outbox` -> ECS outbox worker -> EventBridge emits committed `message.created` and new `conversation.read_cursor_advanced` events. A new EventBridge -> SQS -> Lambda path fans those events to API Gateway WebSocket connections stored ephemerally in DynamoDB. Clients use realtime only as an invalidation/signal layer and reconcile canonical data over HTTP.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, PostgreSQL/Aurora, EventBridge, SQS, API Gateway WebSocket, Lambda Node.js runtime, DynamoDB, Terraform, Cognito.

**Spec:** `docs/superpowers/specs/2026-09-13-realtime-messaging-design.md`

## Global Constraints

- Work only on `feat/aws-native-phase-0-1`.
- Never touch `main`, merge, create a PR, force-push, or reset.
- Re-fetch the live branch head before every write because the branch may move concurrently.
- Message status is **Sent -> Seen** only; never add Delivered.
- Aurora/PostgreSQL remains canonical; realtime is fan-out only.
- Preserve existing `(sender_profile_id, client_message_id)` idempotency.
- Every send must re-check accepted connection and blocked state.
- Never expose Cognito access/refresh tokens to browser JavaScript.
- Realtime ticket validity is at most 60 seconds.
- AWS account is `310356785722`; never use `992382634586`.
- Any eventual staging deployment happens once through the existing guarded workflow; restore all guards to `plan` and verify exact-head CI + remote health afterward.

---

## File Structure

### Existing files to modify

- `src/features/messaging/service.ts` — send authorization; read-cursor event enqueue.
- `src/features/messaging/service.test.ts` — TDD for revoked/block send and read events.
- `src/features/messaging/repository.ts` — direct counterpart lookup, read cursor metadata, catch-up query.
- `src/features/messaging/repository.test.ts` — repository TDD.
- `src/features/messaging/queries.ts` / `queries.test.ts` — canonical thread/read-cursor DTOs and catch-up endpoint semantics.
- `src/features/events/types.ts` — add `conversation.read_cursor_advanced` domain event.
- `src/features/messaging/components/message-shell.tsx` — realtime reconciliation owner.
- `src/features/messaging/components/message-thread.tsx` — actual-view read gating + Sent/Seen render.
- `src/lib/env.ts` — realtime public/server environment validation.
- `package.json` — add only AWS SDK dependencies actually required by application/tests.
- `infra/aws/app/main.tf` or task env sections — inject websocket URL/ticket secret reference where required.

### New application files

- `src/features/messaging/realtime/types.ts` — websocket event DTOs.
- `src/features/messaging/realtime/ticket.ts` / `ticket.test.ts` — HMAC ticket issue/verify primitives.
- `src/features/messaging/realtime/actions.ts` / `actions.test.ts` — authenticated short-lived ticket action.
- `src/features/messaging/realtime/reconcile.ts` / `reconcile.test.ts` — event/message/read-cursor dedupe and merge rules.
- `src/features/messaging/realtime/use-messaging-realtime.ts` — websocket lifecycle/backoff/reconnect hook.
- `src/features/messaging/realtime/read-visibility.ts` / `read-visibility.test.ts` — pure eligibility logic for focus/visibility/viewport.

### New AWS files

- `infra/aws/app/realtime-messaging.tf` — API Gateway/SQS/DynamoDB/Lambda/IAM/alarms/outputs.
- `infra/aws/app/lambda/realtime-authorizer.mjs` — verify ticket and return profile context.
- `infra/aws/app/lambda/realtime-connections.mjs` — `$connect`/`$disconnect` registry operations.
- `infra/aws/app/lambda/realtime-fanout.mjs` — route EventBridge/SQS events to profile connections and clean stale sockets.

---

### Task 1: Close canonical authorization and read-event gaps

**Files:**
- Modify: `src/features/messaging/service.test.ts`
- Modify: `src/features/messaging/service.ts`
- Modify: `src/features/messaging/repository.ts`
- Modify: `src/features/messaging/repository.test.ts`
- Modify: `src/features/events/types.ts`

**Interfaces:**
- Produce `MessagingRepository.findOtherParticipantId(conversationId, actorId): Promise<string | null>`.
- `sendMessage()` must reject with `messaging_not_allowed` when relationship is no longer accepted or is blocked.
- `markConversationRead()` enqueues `conversation.read_cursor_advanced` only when `advanceReadState()` returns true.

- [ ] **Step 1: Write failing send-authorization tests**

Add tests proving an existing participant cannot send after the connection becomes pending/removed or either side is blocked; assert no message insert/outbox enqueue occurs.

- [ ] **Step 2: Run the focused service tests and verify RED**

Run `npm test -- src/features/messaging/service.test.ts` and confirm failures are specifically because send currently checks participation only.

- [ ] **Step 3: Add counterpart lookup repository test and minimal query**

Test that direct conversations resolve the other participant and return null when actor is not part of the pair.

- [ ] **Step 4: Implement minimal send re-authorization**

Inside the transaction: participant check -> resolve counterpart -> `network.findConnectionByPair()` + `network.isPairBlocked()` -> accepted/unblocked required -> existing idempotency/write flow.

- [ ] **Step 5: Write failing read-event tests**

Assert cursor advancement enqueues one routing-safe `conversation.read_cursor_advanced` event; assert no event on a no-op/regressing cursor update.

- [ ] **Step 6: Extend domain event types and minimally implement read-event enqueue**

Payload: `{ eventType, conversationId, readerProfileId, lastReadMessageId, lastReadAt }`.

- [ ] **Step 7: Run focused tests, then full messaging tests**

Run service/repository tests and confirm green before proceeding.

---

### Task 2: Canonical Seen state and catch-up queries

**Files:**
- Modify: `src/features/messaging/repository.ts`
- Modify: `src/features/messaging/repository.test.ts`
- Modify: `src/features/messaging/queries.ts`
- Modify: `src/features/messaging/queries.test.ts`

**Interfaces:**
- Thread response exposes counterpart durable read cursor.
- Add a canonical "messages after newest known message" query ordered by `(created_at, id)`.

- [ ] **Step 1: Write failing repository tests for counterpart read cursor and catch-up ordering.**
- [ ] **Step 2: Run tests and verify RED for missing query behavior.**
- [ ] **Step 3: Implement minimal repository SQL preserving existing `(created_at, id)` ordering.**
- [ ] **Step 4: Write failing query-layer DTO tests for initial Seen state and catch-up.**
- [ ] **Step 5: Implement query DTOs/endpoints with participant authorization.**
- [ ] **Step 6: Run repository/query tests and confirm green.**

---

### Task 3: Signed realtime ticket

**Files:**
- Create: `src/features/messaging/realtime/ticket.test.ts`
- Create: `src/features/messaging/realtime/ticket.ts`
- Create: `src/features/messaging/realtime/actions.test.ts`
- Create: `src/features/messaging/realtime/actions.ts`
- Modify: `src/lib/env.ts`

**Interfaces:**
- `issueRealtimeTicket({ profileId, secret, audience, now?, ttlSeconds? }): string`
- `verifyRealtimeTicket(ticket, { secret, audience, now? }): { profileId: string }`
- authenticated action returns `{ ok: true, ticket, websocketUrl }` or safe failure.

- [ ] **Step 1: Write RED tests for valid ticket, tamper rejection, wrong audience, expiry, and TTL > 60 rejection.**
- [ ] **Step 2: Implement minimal HMAC-SHA256 URL-safe ticket format using Node crypto; never log token contents.**
- [ ] **Step 3: Write RED action tests proving `requireAwsUser()` identity is the ticket identity.**
- [ ] **Step 4: Implement authenticated action and environment parsing.**
- [ ] **Step 5: Run ticket/action tests and confirm green.**

---

### Task 4: Client reconciliation and actual-view read behavior

**Files:**
- Create: `src/features/messaging/realtime/types.ts`
- Create: `src/features/messaging/realtime/reconcile.test.ts`
- Create: `src/features/messaging/realtime/reconcile.ts`
- Create: `src/features/messaging/realtime/read-visibility.test.ts`
- Create: `src/features/messaging/realtime/read-visibility.ts`
- Modify: `src/features/messaging/components/message-thread.tsx`
- Modify: `src/features/messaging/components/message-shell.tsx`

**Interfaces:**
- pure merge/dedupe functions keyed by canonical `messageId` and optimistic `clientMessageId`.
- pure `isReadEligible({ active, documentVisible, windowFocused, inViewport }): boolean`.

- [ ] **Step 1: Write RED tests for duplicate `message.created` events and optimistic->canonical replacement.**
- [ ] **Step 2: Implement minimal reconciliation functions.**
- [ ] **Step 3: Write RED tests for visibility/focus/viewport gating.**
- [ ] **Step 4: Implement pure eligibility helper.**
- [ ] **Step 5: Replace mount-based read marking with IntersectionObserver + focus/visibility gate + debounce.**
- [ ] **Step 6: Render `Sent` for canonical outgoing messages not covered by counterpart cursor and `Seen` when covered; no Delivered state.**
- [ ] **Step 7: Run component/helper tests and existing messaging tests.**

---

### Task 5: Browser websocket lifecycle and canonical reconnect

**Files:**
- Create: `src/features/messaging/realtime/use-messaging-realtime.ts`
- Create focused tests if hook utilities are extracted.
- Modify: `src/features/messaging/components/message-shell.tsx`

**Interfaces:**
- opens socket only after retrieving a short-lived ticket.
- handles `message.created` and `conversation.read_cursor_advanced`.
- exponential backoff + jitter.
- on every connect/reconnect, invoke canonical inbox/unread/thread reconciliation.

- [ ] **Step 1: Extract and RED-test backoff/event-dedupe state machine primitives.**
- [ ] **Step 2: Implement websocket hook using those primitives.**
- [ ] **Step 3: Wire live events into shell state as invalidation signals, not canonical message content.**
- [ ] **Step 4: Verify websocket failure leaves normal server-render/navigation/actions usable.**
- [ ] **Step 5: Run frontend + messaging test suite.**

---

### Task 6: AWS realtime fan-out infrastructure

**Files:**
- Create: `infra/aws/app/realtime-messaging.tf`
- Create: `infra/aws/app/lambda/realtime-authorizer.mjs`
- Create: `infra/aws/app/lambda/realtime-connections.mjs`
- Create: `infra/aws/app/lambda/realtime-fanout.mjs`
- Modify task/environment Terraform only as required.

**Interfaces:**
- DynamoDB table PK `connection_id`, GSI `profile_id`, TTL `expires_at`.
- EventBridge rule accepts `message.created` and `conversation.read_cursor_advanced`.
- SQS queue with DLQ feeds fan-out Lambda.
- fan-out derives recipients from event payload; browser input never supplies recipients.

- [ ] **Step 1: Write lightweight handler tests first if repository test harness supports `.mjs`; otherwise isolate pure handler logic in testable JS modules and test before wiring Terraform.**
- [ ] **Step 2: Implement authorizer ticket verification compatible with application ticket format.**
- [ ] **Step 3: Implement connect/disconnect registry handler.**
- [ ] **Step 4: Implement fan-out handling multiple sockets and deleting Gone connections.**
- [ ] **Step 5: Add Terraform resources, IAM least privilege, log groups, queue/DLQ alarms, and outputs.**
- [ ] **Step 6: Run `terraform fmt -check` and `terraform validate` through the repository's existing CI/guarded validation path.**

---

### Task 7: Exact-head verification and guarded staging deployment

**Files:**
- Existing CI/deployment guard files only; no feature scope expansion.

- [ ] **Step 1: Re-fetch branch head and confirm all deployment/recovery guards are `plan`.**
- [ ] **Step 2: Run exact-head CI including lint, typecheck, unit tests, build, and Terraform validation.**
- [ ] **Step 3: Inspect diff against pre-feature base to ensure no `main`/unrelated changes and no Delivered semantics.**
- [ ] **Step 4: Perform the existing guarded AWS staging deployment exactly once in account `310356785722`.**
- [ ] **Step 5: Restore every deployment/recovery guard to `plan` immediately after deployment.**
- [ ] **Step 6: Verify remote staging health plus direct messaging send, instant receive, Sent->Seen, inbox update, unread update, reconnect catch-up, block enforcement, and refresh fallback.**
- [ ] **Step 7: Re-fetch final branch head and verify exact-head CI for the deployed SHA.**

---

## Self-review

- Spec coverage: authorization, Sent/Seen, realtime auth, fan-out, reconnect/catch-up, dedupe, actual-view read gating, AWS infra, failure degradation, and deployment guards all map to explicit tasks.
- Placeholder scan: no TBD/TODO implementation placeholders are used.
- Type consistency: event name is consistently `conversation.read_cursor_advanced`; canonical message identity is `messageId`; connection identity is `profileId`; read cursor remains message/time based for this phase.
- Scope control: no group chat, typing indicators, presence, attachments, Delivered state, per-message receipts, Redis, or secondary durable message store are introduced.
