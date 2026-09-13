import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const terraform = await readFile(new URL('../../infra/aws/app/realtime.tf', import.meta.url), 'utf8')

test('realtime messaging uses API Gateway WebSocket with ephemeral DynamoDB connections', () => {
  assert.match(terraform, /resource "aws_apigatewayv2_api" "realtime"/)
  assert.match(terraform, /protocol_type\s*=\s*"WEBSOCKET"/)
  assert.match(terraform, /resource "aws_dynamodb_table" "realtime_connections"/)
  assert.match(terraform, /billing_mode\s*=\s*"PAY_PER_REQUEST"/)
  assert.match(terraform, /hash_key\s*=\s*"connection_id"/)
  assert.match(terraform, /realtime_profile_index\s*=\s*"profile_id-index"/)
  assert.match(terraform, /name\s*=\s*local\.realtime_profile_index/)
  assert.match(terraform, /ttl\s*\{/)
  assert.match(terraform, /attribute_name\s*=\s*"expires_at"/)
})

test('connect is authorizer-protected and client messages cannot become canonical writes', () => {
  assert.match(terraform, /resource "aws_apigatewayv2_authorizer" "realtime_connect"/)
  assert.match(terraform, /route_key\s*=\s*"\$connect"/)
  assert.match(terraform, /authorization_type\s*=\s*"CUSTOM"/)
  assert.match(terraform, /route_key\s*=\s*"\$disconnect"/)
  assert.match(terraform, /route_key\s*=\s*"\$default"/)
  assert.match(
    terraform,
    /resource "aws_apigatewayv2_route" "realtime_default"[\s\S]*?target\s*=\s*"integrations\/\$\{aws_apigatewayv2_integration\.realtime_connection\.id\}"/,
  )
  assert.doesNotMatch(terraform, /\bAURORA_|rds-data:|rds-db:/i)
})

test('messaging outbox events fan out through encrypted SQS with a DLQ', () => {
  assert.match(terraform, /resource "aws_sqs_queue" "realtime_events"/)
  assert.match(terraform, /resource "aws_sqs_queue" "realtime_dlq"/)
  assert.match(terraform, /sqs_managed_sse_enabled\s*=\s*true/g)
  assert.match(terraform, /maxReceiveCount\s*=\s*5/)
  assert.match(terraform, /event_bus_name\s*=\s*aws_cloudwatch_event_bus\.social\.name/)
  assert.ok(terraform.includes('"message.created"'))
  assert.ok(terraform.includes('"conversation.read_cursor_advanced"'))
})

test('realtime Lambdas are split by responsibility and fanout can only manage WebSocket connections', () => {
  assert.match(terraform, /resource "aws_lambda_function" "realtime_authorizer"/)
  assert.match(terraform, /resource "aws_lambda_function" "realtime_connection"/)
  assert.match(terraform, /resource "aws_lambda_function" "realtime_fanout"/)
  assert.match(terraform, /"execute-api:ManageConnections"/)
  assert.match(terraform, /"dynamodb:Query"/)
  assert.match(terraform, /"dynamodb:PutItem"/)
  assert.match(terraform, /"dynamodb:DeleteItem"/)
})

test('the ticket signing secret is generated, stored in Secrets Manager and scoped to web plus authorizer', () => {
  assert.match(terraform, /resource "random_password" "realtime_ticket"/)
  assert.match(terraform, /resource "aws_secretsmanager_secret" "realtime_ticket"/)
  assert.match(terraform, /resource "aws_secretsmanager_secret_version" "realtime_ticket"/)
  assert.match(terraform, /REALTIME_TICKET_SECRET/)
  assert.match(terraform, /secretsmanager:GetSecretValue/)
  assert.match(terraform, /REALTIME_WEBSOCKET_URL/)
})
