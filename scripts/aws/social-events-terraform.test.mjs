import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const terraform = await readFile(new URL('../../infra/aws/app/social-events.tf', import.meta.url), 'utf8')
const realtimeTerraform = await readFile(new URL('../../infra/aws/app/realtime.tf', import.meta.url), 'utf8')
const realtimeFanout = await readFile(new URL('../../infra/aws/app/lambda/realtime-fanout.mjs', import.meta.url), 'utf8')
const realtimeClassifier = await import(new URL('./realtime-infra-plan-classifier.mjs', import.meta.url).href)

test('social event infrastructure uses EventBridge, encrypted SQS and a DLQ', () => {
  assert.match(terraform, /resource "aws_cloudwatch_event_bus" "social"/)
  assert.match(terraform, /resource "aws_sqs_queue" "notification_events"/)
  assert.match(terraform, /resource "aws_sqs_queue" "notification_dlq"/)
  assert.match(terraform, /sqs_managed_sse_enabled\s*=\s*true/g)
  assert.match(terraform, /redrive_policy/)
  assert.match(terraform, /maxReceiveCount\s*=\s*5/)
  assert.match(terraform, /resource "aws_cloudwatch_event_target" "notification_queue"/)
  assert.match(terraform, /Service = "events\.amazonaws\.com"/)
})

test('notification routing includes network and feed social event detail types', () => {
  for (const eventType of [
    'user.followed',
    'connection.requested',
    'connection.accepted',
    'post.commented',
    'comment.replied',
    'post.reacted',
    'comment.reacted',
    'post.mentioned',
    'comment.mentioned',
  ]) {
    assert.ok(terraform.includes(`"${eventType}"`), `missing EventBridge detail type ${eventType}`)
  }
  assert.match(terraform, /SOCIAL_NOTIFICATION_MODE[^\n]+shadow/)
})

test('realtime routing carries social invalidations without canonical feed content', () => {
  for (const eventType of [
    'feed.post_created',
    'feed.post_reaction_changed',
    'feed.post_comments_changed',
    'feed.post_reposted',
    'connection.accepted',
  ]) {
    assert.ok(realtimeTerraform.includes(`"${eventType}"`), `missing realtime EventBridge detail type ${eventType}`)
  }

  assert.match(realtimeTerraform, /"dynamodb:Scan"/)
  assert.match(realtimeFanout, /\bScanCommand\b/)
  assert.match(realtimeFanout, /\bExclusiveStartKey\b/)
  assert.match(realtimeFanout, /\bLastEvaluatedKey\b/)
  assert.match(realtimeFanout, /toInvalidationSignal\(event, 'feed'\)/)
  assert.match(realtimeFanout, /toInvalidationSignal\(event, 'network'\)/)
  assert.match(
    realtimeFanout,
    /event\?\.eventType === 'connection\.accepted'[\s\S]*?payload\?\.actorId[\s\S]*?payload\?\.targetId/,
  )

  const invalidationHelper = realtimeFanout.match(
    /function toInvalidationSignal\(event, scope\) \{([\s\S]*?)\n\}/,
  )
  assert.ok(invalidationHelper, 'missing metadata-only realtime invalidation helper')
  assert.match(invalidationHelper[1], /eventId/)
  assert.match(invalidationHelper[1], /eventType/)
  assert.match(invalidationHelper[1], /schemaVersion/)
  assert.match(invalidationHelper[1], /occurredAt/)
  assert.match(invalidationHelper[1], /scope/)
  assert.doesNotMatch(invalidationHelper[1], /aggregateId|payload/)
})

test('realtime social fanout maintenance plan is exact and bounded', () => {
  const maintenancePlan = {
    resource_changes: [
      {
        address: 'aws_cloudwatch_event_rule.realtime_events',
        mode: 'managed',
        change: { actions: ['update'] },
      },
      {
        address: 'aws_iam_role_policy.realtime_fanout',
        mode: 'managed',
        change: { actions: ['update'] },
      },
      {
        address: 'aws_lambda_function.realtime_fanout',
        mode: 'managed',
        change: { actions: ['update'] },
      },
    ],
  }

  const expected = {
    mode: 'social-maintenance',
    createCount: 0,
    updateCount: 3,
    replaceCount: 0,
  }
  assert.deepEqual(realtimeClassifier.classifyRealtimeInfraPlan(maintenancePlan, 'plan'), expected)
  assert.deepEqual(realtimeClassifier.classifyRealtimeInfraPlan(maintenancePlan, 'apply-once'), expected)

  assert.throws(
    () => realtimeClassifier.classifyRealtimeInfraPlan({
      resource_changes: [
        ...maintenancePlan.resource_changes,
        {
          address: 'aws_sqs_queue.realtime_events',
          mode: 'managed',
          change: { actions: ['update'] },
        },
      ],
    }, 'plan'),
    /realtime allowlist|create-only realtime resource change/,
  )
})

test('worker IAM is least privilege and forbidden architecture is absent', () => {
  assert.match(terraform, /"events:PutEvents"/)
  assert.match(terraform, /"sqs:ReceiveMessage"/)
  assert.match(terraform, /"sqs:DeleteMessage"/)
  assert.doesNotMatch(terraform, /kafka|msk|neo4j|neptune|eureka/i)
})

test('outbox and notification workers are separate ECS services using the same app image', () => {
  assert.match(terraform, /resource "aws_ecs_service" "outbox_worker"/)
  assert.match(terraform, /resource "aws_ecs_service" "notification_worker"/)
  assert.match(terraform, /worker:outbox/)
  assert.match(terraform, /worker:notifications/)
  assert.match(terraform, /data\.aws_ecr_repository\.app\.repository_url/)
})
