# AWS Event-Driven Social Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-safe transactional outbox and asynchronous notification delivery pipeline to Sea N Shore without replacing the current AWS-native application or regressing any existing social-network behavior.

**Architecture:** Aurora remains the source of truth. Network mutations write their business row plus an `event_outbox` row in the same PostgreSQL transaction. A bounded publisher sends unpublished events to an AWS EventBridge custom bus, EventBridge routes notification events to SQS, and an idempotent notification consumer creates notification rows and records the consumed event ID. Existing synchronous notification creation remains enabled during shadow mode; async delivery is proven first, then synchronous creation is removed only for event types whose parity is verified.

**Tech Stack:** Next.js/TypeScript, PostgreSQL/Aurora, `pg`, AWS ECS/Fargate, Amazon EventBridge, Amazon SQS + DLQ, Terraform, GitHub Actions, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-07-aws-event-driven-social-backend-design.md`

## Global Constraints

- Work only on `feat/aws-native-phase-0-1`.
- Do not modify `main`, merge, or create a PR.
- Preserve Aurora, Cognito, S3, ECS/Fargate, CloudFront, WAF, and current user-facing behavior.
- Do not introduce Kafka, Neo4j, Neptune, Eureka, Kubernetes microservices, custom JWT auth, or per-service databases in this phase.
- Delivery semantics are at-least-once; notification consumers must be idempotent.
- Existing synchronous notifications remain authoritative until shadow parity is proven.
- No broad Terraform apply; infrastructure changes must use a reviewed narrow plan.
- No production DNS, SES/Cognito email cutover, Supabase/Vercel deletion, or destructive production-data operations.
- Exact-head CI must be green before staging deployment.

---

### Task 1: Add transactional outbox and notification-consumption schema

**Files:**
- Create: `infra/aws/database/migrations/0003_event_outbox.sql`
- Create: `scripts/aws/event-outbox-schema.test.mjs`
- Modify: `.github/workflows/aws-infra-ci.yml`

**Interfaces:**
- Produces table `event_outbox(id uuid, aggregate_type text, aggregate_id uuid, event_type text, schema_version integer, payload jsonb, occurred_at timestamptz, published_at timestamptz, attempts integer, last_error text)`.
- Produces table `notification_event_receipts(event_id uuid primary key, notification_id uuid, processed_at timestamptz)` for consumer idempotency.
- Produces index `event_outbox_unpublished_idx` over unpublished events ordered by `occurred_at, id`.

- [ ] **Step 1: Write the failing schema contract test**

Create `scripts/aws/event-outbox-schema.test.mjs` that reads `0003_event_outbox.sql` and asserts the migration contains:

```js
assert.match(sql, /create table if not exists event_outbox/i)
assert.match(sql, /published_at timestamptz/i)
assert.match(sql, /attempts integer not null default 0/i)
assert.match(sql, /create table if not exists notification_event_receipts/i)
assert.match(sql, /event_id uuid primary key/i)
assert.match(sql, /event_outbox_unpublished_idx/i)
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
node --test scripts/aws/event-outbox-schema.test.mjs
```

Expected: FAIL because `0003_event_outbox.sql` does not exist.

- [ ] **Step 3: Add the migration**

Create `infra/aws/database/migrations/0003_event_outbox.sql` with:

```sql
create table if not exists event_outbox (
  id uuid primary key,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  schema_version integer not null default 1 check (schema_version > 0),
  payload jsonb not null,
  occurred_at timestamptz not null default now(),
  published_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text
);

create index if not exists event_outbox_unpublished_idx
  on event_outbox (occurred_at, id)
  where published_at is null;

create table if not exists notification_event_receipts (
  event_id uuid primary key,
  notification_id uuid,
  processed_at timestamptz not null default now()
);
```

- [ ] **Step 4: Add schema contract test to AWS CI**

Add `node --test scripts/aws/event-outbox-schema.test.mjs` beside the other migration/infrastructure contract tests in `.github/workflows/aws-infra-ci.yml`.

- [ ] **Step 5: Run GREEN checks**

```bash
node --test scripts/aws/event-outbox-schema.test.mjs
npm test -- --run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/aws/database/migrations/0003_event_outbox.sql scripts/aws/event-outbox-schema.test.mjs .github/workflows/aws-infra-ci.yml
git commit -m "db: add transactional event outbox"
```

---

### Task 2: Add typed domain-event and outbox repository boundaries

**Files:**
- Create: `src/features/events/types.ts`
- Create: `src/features/events/outbox-repository.ts`
- Create: `src/features/events/outbox-repository.test.ts`

**Interfaces:**
- Produces `DomainEventType = 'user.followed' | 'connection.requested' | 'connection.accepted'`.
- Produces `DomainEvent` with `{ id, aggregateType, aggregateId, eventType, schemaVersion, occurredAt, payload }`.
- Produces `createOutboxRepositoryForClient(client).enqueue(event)`.

- [ ] **Step 1: Write RED repository tests**

Test that `enqueue()` issues one parameterized insert into `event_outbox`, serializes `payload` as JSON, and never writes `published_at`.

Representative assertion:

```ts
expect(query).toHaveBeenCalledWith(
  expect.stringContaining('insert into event_outbox'),
  [event.id, event.aggregateType, event.aggregateId, event.eventType, event.schemaVersion, event.payload, event.occurredAt],
)
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/features/events/outbox-repository.test.ts
```

Expected: FAIL because the events module does not exist.

- [ ] **Step 3: Implement typed events and repository**

Use `DatabaseQueryClient` from `src/lib/db/client.ts`. Keep SQL inside `outbox-repository.ts`; do not leak database access into services.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/features/events/outbox-repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/events
git commit -m "feat: add domain event outbox repository"
```

---

### Task 3: Emit network events transactionally in shadow mode

**Files:**
- Modify: `src/features/network/service.ts`
- Modify: `src/features/network/service.test.ts`
- Modify: `src/features/network/repository.ts` only if the transaction factory needs to expose event enqueueing cleanly.

**Interfaces:**
- Existing network method signatures remain unchanged.
- `NetworkTransaction` becomes capable of supplying `{ network, outbox }` repositories created from the same PostgreSQL client.
- Events emitted:
  - `user.followed` after a newly-created follow.
  - `connection.requested` after a newly-created connection request.
  - `connection.accepted` after acceptance and mutual follows.
- Existing synchronous `createNotification()` calls remain in place in this task.

- [ ] **Step 1: Write RED service tests**

For each successful mutation, assert exactly one matching outbox event is enqueued and that duplicate/no-op mutations do not enqueue a new event.

Example:

```ts
expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({
  eventType: 'user.followed',
  aggregateType: 'profile',
  aggregateId: targetId,
  payload: expect.objectContaining({ actorId, targetId }),
}))
```

Also assert the existing synchronous notification call still occurs.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/features/network/service.test.ts
```

Expected: new event assertions fail.

- [ ] **Step 3: Implement same-transaction event enqueueing**

Construct both repositories from the same `DatabaseQueryClient` inside `databaseTransaction`. Generate event UUIDs server-side and include only stable identifiers required by downstream consumers.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/features/network/service.test.ts
```

Expected: PASS, including all pre-existing network tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/network/service.ts src/features/network/service.test.ts src/features/network/repository.ts
git commit -m "feat: emit network events to transactional outbox"
```

---

### Task 4: Add bounded outbox publisher with safe row claiming

**Files:**
- Create: `src/features/events/outbox-publisher.ts`
- Create: `src/features/events/outbox-publisher.test.ts`
- Create: `src/lib/aws/eventbridge.ts`
- Create: `src/lib/aws/eventbridge.test.ts`

**Interfaces:**
- Produces `claimOutboxBatch(client, limit)` using `FOR UPDATE SKIP LOCKED` inside a DB transaction.
- Produces `publishOutboxBatch({ limit, publisher })`.
- `publisher.publish(event)` maps to EventBridge `PutEvents` using source `sea-n-shore.social` and detail type equal to `eventType`.
- Marks `published_at` only for successfully accepted EventBridge entries.
- Increments `attempts` and stores bounded `last_error` on failures.

- [ ] **Step 1: Write RED tests for row claiming and publish outcome handling**

Assert SQL contains `for update skip locked`, batch size is bounded, successes mark `published_at`, failures do not, and partial EventBridge failures are handled per event.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/features/events/outbox-publisher.test.ts src/lib/aws/eventbridge.test.ts
```

Expected: FAIL because publisher modules do not exist.

- [ ] **Step 3: Implement publisher**

Use AWS SDK EventBridge client. Never publish inside the business mutation transaction. Cap batches at 10 to match EventBridge `PutEvents` request size.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/features/events/outbox-publisher.test.ts src/lib/aws/eventbridge.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/events/outbox-publisher.ts src/features/events/outbox-publisher.test.ts src/lib/aws/eventbridge.ts src/lib/aws/eventbridge.test.ts
git commit -m "feat: add bounded EventBridge outbox publisher"
```

---

### Task 5: Add idempotent notification event consumer

**Files:**
- Create: `src/features/notifications/event-consumer.ts`
- Create: `src/features/notifications/event-consumer.test.ts`
- Modify: `src/features/notifications/repository.ts`
- Modify: `src/features/notifications/repository.test.ts`

**Interfaces:**
- Produces `consumeNotificationEvent(event)` for the three phase-1 event types.
- Repository adds `createNotificationFromEvent({ eventId, recipientId, actorId, type, connectionId? })`.
- The notification insert and `notification_event_receipts` insert run in one Aurora transaction.
- Duplicate `eventId` returns success/no-op instead of creating another notification.

- [ ] **Step 1: Write RED idempotency tests**

Assert the same event processed twice creates one notification. Assert payload-to-notification mapping:

```text
user.followed           -> new_follower
connection.requested    -> connection_request
connection.accepted     -> connection_accepted
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/features/notifications/event-consumer.test.ts src/features/notifications/repository.test.ts
```

Expected: FAIL because consumer/idempotent repository methods are absent.

- [ ] **Step 3: Implement consumer and idempotent repository transaction**

Use `notification_event_receipts.event_id` as the dedupe key. Treat unique-key conflict as already processed only after verifying no partial notification state can be produced.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run src/features/notifications/event-consumer.test.ts src/features/notifications/repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/notifications/event-consumer.ts src/features/notifications/event-consumer.test.ts src/features/notifications/repository.ts src/features/notifications/repository.test.ts
git commit -m "feat: consume social notification events idempotently"
```

---

### Task 6: Add AWS EventBridge, SQS, DLQ and least-privilege IAM

**Files:**
- Create: `infra/aws/app/social-events.tf`
- Modify: `infra/aws/app/main.tf` only if existing ECS task/service variables must be reused.
- Modify: `infra/aws/app/aws-native-variables.tf` only for explicit worker controls.
- Modify: `infra/aws/app/terraform.tfvars.example`
- Create: `scripts/aws/social-events-terraform.test.mjs`
- Modify: `.github/workflows/aws-infra-ci.yml`

**Interfaces:**
- Custom EventBridge bus: `${local.name_prefix}-social-events`.
- SQS notification queue + DLQ with redrive policy.
- EventBridge rule routes only the three supported event types.
- App/outbox publisher IAM can `events:PutEvents` only to the custom bus.
- Notification worker IAM can receive/delete/change visibility only on its queue and can access the existing Aurora secret/network path required by the worker.

- [ ] **Step 1: Write RED Terraform contract test**

Assert Terraform includes `aws_cloudwatch_event_bus`, `aws_sqs_queue` for main + DLQ, `redrive_policy`, an EventBridge target to SQS, queue policy allowing `events.amazonaws.com`, and no Kafka/MSK/Neptune resources.

- [ ] **Step 2: Run RED**

```bash
node --test scripts/aws/social-events-terraform.test.mjs
```

Expected: FAIL because `social-events.tf` does not exist.

- [ ] **Step 3: Implement Terraform resources**

Use current naming/local conventions from `infra/aws/app`. Set encryption on both SQS queues. Configure finite receive count before DLQ redrive. Add CloudWatch alarms for DLQ depth and queue age only if the repository already has an alarm convention; otherwise expose metrics in the readiness script in Task 9.

- [ ] **Step 4: Run Terraform validation and contract tests**

```bash
node --test scripts/aws/social-events-terraform.test.mjs
terraform -chdir=infra/aws/app fmt -check
terraform -chdir=infra/aws/app validate
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/aws/app/social-events.tf infra/aws/app/main.tf infra/aws/app/aws-native-variables.tf infra/aws/app/terraform.tfvars.example scripts/aws/social-events-terraform.test.mjs .github/workflows/aws-infra-ci.yml
git commit -m "infra: define social event delivery pipeline"
```

---

### Task 7: Add worker entrypoints without creating new microservices

**Files:**
- Create: `scripts/workers/publish-outbox.mjs`
- Create: `scripts/workers/consume-notifications.mjs`
- Create: `scripts/workers/worker-contract.test.mjs`
- Modify: `package.json`
- Modify: `Dockerfile` only if the existing production image cannot run the worker commands directly.
- Modify: `infra/aws/app/social-events.tf`

**Interfaces:**
- `npm run worker:outbox` continuously polls bounded outbox batches with sleep/backoff when empty.
- `npm run worker:notifications` long-polls SQS, validates message envelopes, invokes the idempotent consumer, deletes only after successful consumption.
- Both workers terminate cleanly on SIGTERM for ECS deployments.
- Terraform creates separate ECS task definitions/services from the same image rather than separate repositories or Kubernetes workloads.

- [ ] **Step 1: Write RED worker contract tests**

Assert package scripts exist, workers install SIGTERM handlers, SQS receive uses long polling, and message deletion occurs only after consumer success.

- [ ] **Step 2: Run RED**

```bash
node --test scripts/workers/worker-contract.test.mjs
```

Expected: FAIL because worker files/scripts are absent.

- [ ] **Step 3: Implement worker entrypoints and ECS task/service definitions**

Keep desired count at 1 for staging. Reuse the existing application image. Worker services do not need ALB registration.

- [ ] **Step 4: Run GREEN and Docker build**

```bash
node --test scripts/workers/worker-contract.test.mjs
npm test -- --run
docker build -t sea-n-shore-event-workers:test .
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/workers package.json Dockerfile infra/aws/app/social-events.tf
git commit -m "feat: add ECS social event workers"
```

---

### Task 8: Add shadow-mode parity verification

**Files:**
- Create: `scripts/aws/audit-social-event-parity.sh`
- Create: `.github/workflows/aws-social-event-parity.yml`
- Create: `scripts/aws/social-event-parity.test.mjs`

**Interfaces:**
- Read-only audit reports counts for outbox unpublished/published/failed events, SQS visible/in-flight messages, DLQ depth, processed receipts, and synchronous-vs-async notification semantic duplicates.
- Audit never prints raw email addresses or notification content.
- Shadow mode remains enabled until every supported event type has zero missing async receipts and zero DLQ messages over the verification window.

- [ ] **Step 1: Write RED audit contract test**

Assert audit queries are read-only and include metrics for outbox backlog, receipts, queue depth, DLQ depth, and event-type parity.

- [ ] **Step 2: Run RED**

```bash
node --test scripts/aws/social-event-parity.test.mjs
```

Expected: FAIL because audit does not exist.

- [ ] **Step 3: Implement read-only audit and workflow**

Run through the existing GitHub OIDC/bootstrap SSM boundary if direct GitHub role permissions are insufficient. Do not expand permissions just for audit convenience.

- [ ] **Step 4: Run GREEN**

```bash
node --test scripts/aws/social-event-parity.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/aws/audit-social-event-parity.sh scripts/aws/social-event-parity.test.mjs .github/workflows/aws-social-event-parity.yml
git commit -m "ci: audit social event shadow parity"
```

---

### Task 9: Add runtime observability and regression guards

**Files:**
- Modify: `scripts/aws/audit-independence-readiness.sh`
- Modify: `.github/workflows/aws-remote-verify.yml`
- Create: `scripts/aws/social-event-runtime.test.mjs`

**Interfaces:**
- Runtime verification reports outbox worker ECS service state, notification worker ECS service state, queue depth, oldest-message age, DLQ depth, and recent worker CloudWatch strong errors.
- Regression guard rejects Kafka/MSK/Neo4j/Neptune/Eureka dependencies in active app/infra code for this phase.

- [ ] **Step 1: Write RED runtime contract test**

Assert verification includes both worker services and DLQ/queue metrics and that forbidden architecture dependencies are absent.

- [ ] **Step 2: Implement verification updates**

Keep checks read-only and exact-head gated.

- [ ] **Step 3: Run GREEN**

```bash
node --test scripts/aws/social-event-runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/aws/audit-independence-readiness.sh .github/workflows/aws-remote-verify.yml scripts/aws/social-event-runtime.test.mjs
git commit -m "ci: verify social event worker runtime"
```

---

### Task 10: Exact-head CI, narrow infrastructure plan/apply, database migration and staging workers

**Files:**
- No design changes unless verification exposes a defect.
- Use existing migration/deployment scripts and add a narrowly scoped workflow only if the current workflows cannot safely apply the migration/social-event resources.

**Interfaces:**
- All prior tasks must be green before any AWS change.
- Infrastructure apply must contain only `0003` schema migration plus social-event EventBridge/SQS/IAM/ECS worker resources and direct dependencies known in the saved plan.

- [ ] **Step 1: Run full local/CI-equivalent verification**

```bash
npm run lint
npm test -- --run
npm run build
node --test scripts/aws/event-outbox-schema.test.mjs
node --test scripts/aws/social-events-terraform.test.mjs
node --test scripts/workers/worker-contract.test.mjs
node --test scripts/aws/social-event-parity.test.mjs
node --test scripts/aws/social-event-runtime.test.mjs
terraform -chdir=infra/aws/app fmt -check
terraform -chdir=infra/aws/app validate
```

Expected: all PASS.

- [ ] **Step 2: Require exact-head AWS Infrastructure CI success**

Do not apply or deploy from a SHA whose exact-head CI is incomplete or failed.

- [ ] **Step 3: Generate a saved Terraform plan and review actual resource changes**

Reject the plan if it changes unrelated ALB/CloudFront/Cognito/SES/Aurora settings or performs destructive replacement.

- [ ] **Step 4: Apply only the reviewed saved plan**

Verify EventBridge bus, SQS queue/DLQ, IAM policies, worker task definitions/services are live.

- [ ] **Step 5: Apply `0003_event_outbox.sql` through the existing controlled Aurora migration path**

Verify tables/indexes exist before enabling worker desired count.

- [ ] **Step 6: Deploy exact-head application image and workers to staging**

Verify web ECS remains healthy and both worker services reach stable desired/running counts.

- [ ] **Step 7: Run post-deploy remote verification**

Require no strong CloudWatch errors, zero DLQ messages, and bounded/clearing outbox backlog.

---

### Task 11: Prove shadow parity, then cut over supported notification types

**Files:**
- Modify: `src/features/network/service.ts`
- Modify: `src/features/network/service.test.ts`
- Modify: `docs/superpowers/specs/2026-09-07-aws-event-driven-social-backend-design.md` only to record the verified cutover state, not to change architecture.

**Interfaces:**
- Remove synchronous `createNotification()` calls only for event types that have verified async parity.
- Business mutation + outbox event remains one Aurora transaction.
- User-facing network actions no longer depend on downstream notification insertion latency.

- [ ] **Step 1: Collect shadow-mode evidence**

Require for all three event types:

```text
missing async receipts = 0
DLQ messages = 0
consumer duplicate notifications = 0
publisher backlog is clearing
worker services stable
```

- [ ] **Step 2: Write RED tests for async-only behavior**

Update network service tests to assert successful network mutations enqueue the event but do not call synchronous `createNotification()` for the three migrated notification types.

- [ ] **Step 3: Remove synchronous notification writes for verified event types**

Do not change notification display/read behavior.

- [ ] **Step 4: Run network + notification + full suite GREEN**

```bash
npx vitest run src/features/network/service.test.ts src/features/notifications/event-consumer.test.ts
npm test -- --run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/network/service.ts src/features/network/service.test.ts docs/superpowers/specs/2026-09-07-aws-event-driven-social-backend-design.md
git commit -m "feat: cut network notifications over to async events"
```

- [ ] **Step 6: Exact-head CI and staging deploy**

Require full exact-head CI success before staging deployment.

- [ ] **Step 7: Live verification**

Create/follow/request/accept test relationships in staging using test accounts, verify exactly one notification per action, verify no visible behavior regression, verify DLQ remains zero, and check CloudWatch strong errors.

---

## Self-Review

- **Spec coverage:** transactional outbox, EventBridge/SQS delivery, idempotency, retries/DLQ, shadow migration, same-transaction network events, service boundaries, observability, security constraints, and future recommendation readiness are each represented by explicit tasks.
- **Placeholder scan:** no implementation step depends on undefined TODO/TBD placeholders. Follow-on recommendation/analytics/email/push consumers are intentionally outside this phase and are not prerequisites.
- **Type consistency:** the plan consistently uses `DomainEvent`, `createOutboxRepositoryForClient`, `event_outbox`, `notification_event_receipts`, `user.followed`, `connection.requested`, and `connection.accepted` across producer, publisher, consumer, infrastructure, audit, and cutover tasks.
