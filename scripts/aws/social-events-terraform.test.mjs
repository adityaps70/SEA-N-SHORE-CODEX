import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const terraform = await readFile(new URL('../../infra/aws/app/social-events.tf', import.meta.url), 'utf8')

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
