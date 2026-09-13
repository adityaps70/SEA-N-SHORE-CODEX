# Sea N Shore Realtime Messaging Design

**Date:** 2026-09-13

**Status:** Approved architecture, implementation pending

## Goal

Upgrade direct messaging into a realtime chat experience while keeping PostgreSQL/Aurora as the sole source of truth. Realtime is notification/fan-out only.

## Core semantics

- Message status is **Sent -> Seen** only. There is no Delivered state.
- `Sent` means the message transaction committed in Aurora.
- `Seen` means the other participant's durable read cursor advanced past that message.
- WebSocket acknowledgements never affect message status.
- Existing `clientMessageId` idempotency remains authoritative.
- Refresh/navigation must remain correct when realtime is unavailable.

## Approved AWS architecture

```text
HTTPS send/read
  -> Next.js/ECS
  -> auth + messaging authorization
  -> Aurora transaction
       canonical rows + event_outbox
  -> commit
  -> existing ECS outbox worker
  -> EventBridge
  -> realtime SQS
  -> fan-out Lambda
  -> API Gateway WebSocket
  -> authenticated browser connections
```

Use API Gateway WebSocket + Lambda + DynamoDB active-connection registry. DynamoDB stores only ephemeral connection metadata, never canonical messages, unread state, conversations, or read receipts.

## Authorization

Every send must verify:

1. actor is a conversation participant,
2. direct counterpart is resolved server-side,
3. connection is still `accepted`,
4. pair is not blocked.

Historical conversation reading remains allowed to existing participants after relationship changes; this does not grant send permission.

## Authentication

Keep Cognito access/refresh tokens HttpOnly. An authenticated application endpoint issues a signed realtime ticket valid for at most 60 seconds. `$connect` validates signature, expiry and audience and derives `profileId`; the client cannot choose another identity.

DynamoDB connection record:

```text
connection_id PK
profile_id
connected_at
expires_at
```

A `profile_id` GSI supports multiple tabs/devices. `$disconnect` and stale fan-out cleanup delete obsolete connections.

## Realtime event model

`message.created` remains routing-safe and contains canonical IDs, not the message body. Add `conversation.read_cursor_advanced` only when a durable cursor really advances.

```json
{
  "eventType": "conversation.read_cursor_advanced",
  "schemaVersion": 1,
  "conversationId": "uuid",
  "readerProfileId": "uuid",
  "lastReadMessageId": "uuid",
  "lastReadAt": "ISO-8601"
}
```

EventBridge/SQS/WebSocket delivery is at-least-once; clients deduplicate by event ID and canonical message ID.

## Read/Seen behavior

Keep one durable read cursor per participant. Do not create per-message receipt rows.

Do not mark read just because the React thread mounted. A received message is eligible only when the conversation is active, the document is visible, the window has focus, and the message area is actually observed in the viewport. Use a short debounce so bursts advance once to the newest actually viewed received message.

For this phase preserve canonical ordering by `(created_at, id)` rather than add a sequence column.

## Reconnect/catch-up

WebSocket state is disposable. After every connect/reconnect:

- refresh canonical inbox,
- refresh unread count,
- reconcile active thread against Aurora,
- refresh counterpart read cursor for Seen state.

Use exponential backoff with jitter. No durable websocket/event offset is required; Aurora repairs missed events.

## Failure model

- DB commit succeeds + realtime fails: message remains valid Sent; outbox/reconnect catches up.
- duplicate event: canonical ID reconciliation removes duplication.
- stale socket: fan-out deletes the stale connection.
- realtime unavailable: HTTP messaging/history/read flows remain usable.
- fan-out poison event: SQS DLQ + CloudWatch alarm; canonical messaging remains healthy.

## Infrastructure

Add a focused Terraform realtime module/file under `infra/aws/app/` containing:

- API Gateway v2 WebSocket API/stage/routes,
- Lambda authorizer,
- connect/disconnect handler,
- DynamoDB connection table + GSI + TTL,
- EventBridge rule,
- realtime SQS + DLQ,
- fan-out Lambda,
- IAM/log groups/alarms,
- WebSocket endpoint outputs.

Existing CloudFront -> ALB -> ECS application routing remains unchanged.

## Security

- Never expose Cognito access/refresh tokens to JS.
- Realtime ticket secret is managed configuration/secret, never source-controlled.
- Ticket validity <= 60 seconds.
- Do not log tickets, tokens or message bodies.
- Fan-out recipients come only from committed domain events.
- WebSocket transport never performs canonical business writes.

## TDD requirements

Tests must be written and observed failing before production implementation for:

- send denied after block/connection revocation,
- read event emitted only on actual cursor advance,
- monotonic cursor/catch-up queries,
- realtime ticket tamper/expiry/audience validation,
- fan-out multi-device + stale connection handling,
- duplicate event/message reconciliation,
- focus/visibility/viewport read gating,
- degraded realtime while HTTP flows remain correct.

## Deployment constraints

Work only on `feat/aws-native-phase-0-1`; never touch `main`, merge, create a PR, force-push or reset. Re-fetch branch head before writes. Use AWS account `310356785722` only; never `992382634586`. Eventual staging deployment occurs once via existing guarded flow, all guards are restored to `plan`, then exact-head CI and remote health are verified.

## Ambiguity/contradiction audit

Resolved decisions:

- realtime carries committed notifications only, never writes;
- Delivered does not exist;
- Sent is DB-commit semantics;
- Seen is durable cursor semantics;
- every send re-checks accepted/unblocked relationship;
- historical read access and send authorization are intentionally different;
- refresh/reconnect canonical reconciliation repairs missed websocket events;
- one participant read cursor remains authoritative;
- `(created_at, id)` remains the ordering primitive for this phase;
- actual-view gating replaces mount-based read marking;
- realtime failure cannot make canonical messaging incorrect.
