import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const terraform = await readFile(new URL('../../infra/aws/app/realtime.tf', import.meta.url), 'utf8')
const mainTerraform = await readFile(new URL('../../infra/aws/app/main.tf', import.meta.url), 'utf8')
const edgeTerraform = await readFile(new URL('../../infra/aws/app/edge.tf', import.meta.url), 'utf8')
const authorizer = await readFile(new URL('../../infra/aws/app/lambda/realtime-authorizer.mjs', import.meta.url), 'utf8')
const connectionLambda = await readFile(new URL('../../infra/aws/app/lambda/realtime-connection.mjs', import.meta.url), 'utf8')

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

test('connect is authorizer-protected and the default route only supports ephemeral typing signals', () => {
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
  assert.match(connectionLambda, /routeKey === '\$default'/)
  assert.match(connectionLambda, /action !== 'typing'/)
  assert.match(connectionLambda, /conversation\.typing/)
  assert.match(connectionLambda, /PostToConnectionCommand/)
  assert.doesNotMatch(connectionLambda, /public\.messages|event_outbox|rds-data:/i)
})

test('realtime authorizer only accepts the canonical domain, the domain-move alias domains and the managed CloudFront public origin', () => {
  assert.match(edgeTerraform, /resource "aws_cloudfront_distribution" "app"/)
  assert.match(edgeTerraform, /canonical_site_url\s*=\s*"https:\/\/\$\{local\.canonical_site_host\}"/)
  assert.match(edgeTerraform, /canonical_site_host\s*=\s*"seanshore\.in"/)
  assert.match(edgeTerraform, /edge_site_url\s*=\s*"https:\/\/\$\{aws_cloudfront_distribution\.app\.domain_name\}"/)
  assert.match(edgeTerraform, /browser_site_urls\s*=\s*concat\(\[local\.canonical_site_url\], \[for host in local\.site_alias_hosts : "https:\/\/\$\{host\}"\], \[local\.edge_site_url\]\)/)
  // Domain move: the one alias domain, seanshore.net, and nothing else (scripts/aws/domain-move-infra.test.mjs).
  assert.match(edgeTerraform, /site_alias_hosts\s*=\s*\["seanshore\.net"\]/)
  assert.match(terraform, /REALTIME_ALLOWED_ORIGINS\s*=\s*join\(",", local\.browser_site_urls\)/)
  assert.doesNotMatch(terraform, /REALTIME_ALLOWED_ORIGINS?\s*=\s*var\.site_url/)
  assert.match(authorizer, /process\.env\.REALTIME_ALLOWED_ORIGINS/)
  assert.match(authorizer, /isOriginAllowed\(origin\)/)
})

test('realtime authorizer emits bounded non-sensitive deny reason codes', () => {
  assert.match(authorizer, /\[realtime_authorizer_deny\]/)
  for (const reason of [
    'origin_mismatch',
    'missing_ticket',
    'malformed_ticket',
    'signature_mismatch',
    'invalid_payload',
    'audience_mismatch',
    'invalid_expiry',
    'expired_ticket',
  ]) {
    assert.match(authorizer, new RegExp(`['"]${reason}['"]`))
  }
  assert.doesNotMatch(authorizer, /console\.(?:log|warn|error)\([^\n]*(?:suppliedSignature|encodedPayload|secretArn|ticket\s*[,)])/)
})

test('messaging outbox events fan out through encrypted SQS with a DLQ', () => {
  assert.match(terraform, /resource "aws_sqs_queue" "realtime_events"/)
  assert.match(terraform, /resource "aws_sqs_queue" "realtime_dlq"/)
  assert.match(terraform, /sqs_managed_sse_enabled\s*=\s*true/g)
  assert.match(terraform, /maxReceiveCount\s*=\s*5/)
  assert.match(terraform, /event_bus_name\s*=\s*aws_cloudwatch_event_bus\.social\.name/)
  assert.ok(terraform.includes('"message.created"'))
  assert.ok(terraform.includes('"message.updated"'))
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

test('the ticket signing secret is generated and scoped to web plus authorizer', () => {
  assert.match(terraform, /resource "random_password" "realtime_ticket"/)
  assert.match(terraform, /resource "aws_secretsmanager_secret" "realtime_ticket"/)
  assert.match(terraform, /resource "aws_secretsmanager_secret_version" "realtime_ticket"/)
  assert.match(terraform, /secretsmanager:GetSecretValue/)
  assert.match(mainTerraform, /name\s*=\s*"REALTIME_WEBSOCKET_URL"\s*,\s*value\s*=\s*local\.realtime_websocket_url/)
  assert.match(mainTerraform, /name\s*=\s*"REALTIME_TICKET_SECRET"[\s\S]*?valueFrom\s*=\s*aws_secretsmanager_secret\.realtime_ticket\.arn/)
  assert.match(mainTerraform, /aws_iam_role_policy\.ecs_execution_realtime_ticket_secret/)
})

test('archive and random providers stay within their reviewed major-version ranges', () => {
  assert.match(mainTerraform, /archive\s*=\s*\{[\s\S]*?source\s*=\s*"hashicorp\/archive"[\s\S]*?version\s*=\s*"~> 2\.7"/)
  assert.match(mainTerraform, /random\s*=\s*\{[\s\S]*?source\s*=\s*"hashicorp\/random"[\s\S]*?version\s*=\s*"~> 3\.7"/)
})

