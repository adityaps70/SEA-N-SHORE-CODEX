# AWS Event-Driven Social Backend Design

## Goal

Improve the Sea N Shore backend by borrowing the strongest architectural ideas from a LinkedIn-style microservice system without replacing the existing AWS-native stack or introducing unnecessary Kafka, Neo4j, Eureka, Kubernetes, or custom-auth complexity.

## Current baseline

Sea N Shore is a modular Next.js application running on ECS/Fargate with Aurora PostgreSQL as the source of truth, Cognito for authentication, S3 for media, CloudFront/WAF at the edge, and CloudWatch/GitHub Actions for operations. Network, feed, profiles, notifications, auth, and media already have explicit service/repository boundaries.

The current network service performs relationship changes and notification inserts synchronously inside one Aurora transaction. This is safe and consistent, but it couples the user request to every downstream side effect and gives us no reusable event stream for recommendations, analytics, email, or future push notifications.

## Decision

Add a transactional outbox and AWS-native asynchronous processing while retaining the existing modular monolith.

Phase 1 flow:

```text
User action
  -> Network service
      -> Aurora transaction
          -> relationship mutation
          -> outbox row
      -> request completes

Outbox publisher
  -> EventBridge custom bus
      -> notification SQS queue
          -> notification worker
              -> idempotent Aurora notification insert
```

Aurora remains the system of record. EventBridge is the routing layer. SQS provides durable buffering, retries, visibility timeout, and DLQ support. The worker is deployed from the same repository/image as a separate ECS service/task so we do not split the codebase into independently deployed microservices yet.

## Why not Kafka

Kafka/MSK adds brokers, partitions, offsets, consumer-group operations, retention management, and significantly higher operational cost. Sea N Shore does not currently need that throughput or replay model. EventBridge + SQS gives us durable fan-out and at-least-once delivery with much lower operational burden.

## Why not Neo4j or Neptune yet

The current Aurora relationship model is sufficient for follows, connection requests, accepted connections, blocking, and the existing recommendation logic. Network events will be shaped so a future Neptune projection can consume them later without changing the write model. We will not add a graph database until graph queries become a demonstrated bottleneck or product requirement.

## Phase 1 event scope

Only network events with an immediate notification consumer are included initially:

- `network.followed.v1`
- `network.connection_requested.v1`
- `network.connection_accepted.v1`

We deliberately do not emit every possible feed or profile event yet. `post.created`, `post.liked`, analytics events, recommendation events, email, and push are follow-on consumers once the pipeline is proven.

## Event envelope

Every event uses one stable envelope:

```json
{
  "eventId": "uuid",
  "eventType": "network.followed.v1",
  "schemaVersion": 1,
  "aggregateType": "network_relationship",
  "aggregateId": "uuid-or-stable-pair-key",
  "actorProfileId": "uuid",
  "occurredAt": "2026-09-07T12:34:56.000Z",
  "payload": {}
}
```

Payloads contain only IDs and relationship state required by consumers. They must not contain raw email addresses, credentials, session tokens, or unnecessary PII.

### `network.followed.v1`

```json
{
  "targetProfileId": "uuid"
}
```

### `network.connection_requested.v1`

```json
{
  "connectionId": "uuid",
  "targetProfileId": "uuid"
}
```

### `network.connection_accepted.v1`

```json
{
  "connectionId": "uuid",
  "requesterProfileId": "uuid"
}
```

These fields are sufficient for the notification consumer and are also useful future recommendation signals.

## Transactional outbox

Create `public.domain_event_outbox` with:

- `id uuid primary key`
- `event_type text not null`
- `schema_version integer not null`
- `aggregate_type text not null`
- `aggregate_id text not null`
- `actor_profile_id uuid references public.profiles(id)`
- `payload jsonb not null`
- `occurred_at timestamptz not null default now()`
- `published_at timestamptz null`
- `publish_attempts integer not null default 0`
- `last_error text null`
- `created_at timestamptz not null default now()`

Index unpublished rows by `(published_at, occurred_at, id)` with a partial index where `published_at is null`.

The relationship mutation and outbox insert MUST use the same Aurora transaction. A relationship change without its event and an event without its relationship change must never commit.

## Publisher semantics

The publisher reads bounded batches of unpublished rows using row locking compatible with concurrent publishers (`FOR UPDATE SKIP LOCKED`). It publishes each event to a dedicated EventBridge bus and marks `published_at` only after EventBridge acknowledges the put.

Publishing is at-least-once. A crash after EventBridge accepts an event but before Aurora is marked published may produce a duplicate. Consumers therefore MUST be idempotent.

On publish failure:

- increment `publish_attempts`
- store a bounded/sanitized `last_error`
- leave `published_at` null
- retry on the next publisher cycle

The publisher must not block user-facing requests.

## EventBridge and SQS

Create:

- custom EventBridge bus: Sea N Shore social domain events
- EventBridge rule matching `network.*`
- notification SQS queue
- notification DLQ
- redrive policy
- queue policy allowing only the EventBridge rule to send

The notification queue uses long polling. Visibility timeout must exceed the worker's maximum per-message processing time. Messages move to the DLQ after a small bounded number of failed deliveries.

## Notification consumer and idempotency

Add `source_event_id uuid` to `public.notifications` (nullable during migration) with a unique partial index where not null.

The worker:

1. validates the event envelope and supported schema version
2. maps supported network event types to current notification semantics
3. inserts the notification with `source_event_id = eventId`
4. treats unique-conflict on `source_event_id` as successful duplicate delivery
5. deletes the SQS message only after successful/idempotent processing

Mapping parity:

- `network.followed.v1` -> `new_follower`
- `network.connection_requested.v1` -> `connection_request` with `connection_id`
- `network.connection_accepted.v1` -> `connection_accepted` with `connection_id`

The UI and notification query model remain unchanged.

## Migration strategy

We will not switch from synchronous notifications to asynchronous notifications in one step.

### Stage A — schema and outbox only

Add the outbox schema, event contracts, repository APIs, tests, and publisher/consumer code. Existing synchronous notification creation remains authoritative.

### Stage B — shadow event flow

Network actions write the outbox event in the same transaction while still creating the existing synchronous notification. The async worker runs in shadow mode and records/validates event consumption without inserting duplicate user-visible notifications.

### Stage C — asynchronous notification creation

After staging proves event completeness, ordering assumptions, idempotency, retry, and DLQ behavior, remove the synchronous notification insert for the three migrated event types and enable worker inserts.

This staged migration prevents notification loss during rollout.

## Service boundaries

No microservice split is introduced. Existing modules stay in the same application repository and deployment artifact.

- Network Service owns relationship invariants and emits domain events.
- Notification Service owns notification mapping and persistence.
- Feed Service remains unchanged in Phase 1.
- Media Service remains S3-backed and unchanged.
- Search/Recommendation code can consume projected relationship signals later.
- Event infrastructure lives under a focused `src/lib/events` or equivalent module and does not leak AWS SDK details into domain services.

## Security

- No credentials or PII in event payloads.
- ECS task roles use least-privilege permissions.
- Web task does not need SQS consume permissions.
- Publisher gets only EventBridge `PutEvents` plus required database access.
- Notification worker gets only SQS receive/delete/change-visibility plus required database access.
- Queue policy only accepts EventBridge sends from the specific rule/bus.
- Blocking and interactability checks remain in the network transaction before events are emitted.

## Observability

Emit structured CloudWatch logs for:

- event published
- event publish failure
- event consumed
- duplicate event ignored
- unsupported event/schema
- notification processing failure

Monitor:

- oldest unpublished outbox age
- unpublished outbox count
- EventBridge failed invocations
- SQS visible/in-flight message counts
- DLQ depth
- worker task health/restarts

An outbox backlog or non-empty DLQ must be visible without reading application logs manually.

## Failure behavior

- If Aurora relationship mutation fails: no event is committed.
- If outbox insert fails: transaction rolls back, so relationship mutation also fails.
- If EventBridge is unavailable: user request remains successful after Aurora commit; unpublished outbox rows accumulate and retry later.
- If notification worker fails: SQS retries; repeated failures go to DLQ.
- If the same message is delivered multiple times: unique `source_event_id` makes processing idempotent.
- If an unknown schema version arrives: worker rejects it safely and lets retry/DLQ handling surface it.

## Testing

Required automated coverage:

- migration/schema contract tests
- network service tests proving mutation + event occur in one transaction boundary
- outbox repository selection/locking/publish-state tests
- event envelope validation tests
- notification event mapping tests
- duplicate delivery/idempotency tests
- unsupported schema/event tests
- Terraform validation and focused resource-contract tests
- existing feed/network/notification regression tests remain green

Staging acceptance requires:

- exact-head CI green
- targeted Terraform plan contains only approved event resources/schema-supporting changes
- database migration applied safely
- publisher/worker ECS services healthy
- outbox drains under test actions
- no duplicate user-visible notifications
- deliberate worker failure retries and reaches DLQ in a controlled test, then redrive succeeds
- existing connection/follow/block flows remain unchanged from the user's perspective
- CloudWatch strong-error scan clean after rollout

## Non-goals for this phase

- Kafka/MSK
- Neo4j or Neptune
- independent microservice repositories
- Kubernetes/EKS
- custom JWT/authentication
- replacing Cognito
- feed fan-out architecture
- recommendation product redesign
- analytics warehouse
- email or push notifications
- changing current website navigation or visual design

## Follow-on opportunities

Once Phase 1 is proven, the same event backbone can support:

- People You May Know signal projection
- same-company/vessel/rank recommendations
- second-degree connection scoring
- asynchronous email/push notifications
- analytics and product telemetry
- moderation workflows
- feed ranking signals
- eventual Neptune graph projection if scale justifies it
