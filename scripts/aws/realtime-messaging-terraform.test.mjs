import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const terraform = await readFile(new URL('../../infra/aws/app/realtime.tf', import.meta.url), 'utf8')
const mainTerraform = await readFile(new URL('../../infra/aws/app/main.tf', import.meta.url), 'utf8')
const authorizer = await readFile(new URL('../../infra/aws/app/lambda/realtime-authorizer.mjs', import.meta.url), 'utf8')

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

test('realtime infrastructure release is bounded, guarded, and executed through the bootstrap host', async () => {
  const classifierUrl = new URL('./realtime-infra-plan-classifier.mjs', import.meta.url)
  const scriptUrl = new URL('./realtime-infra.sh', import.meta.url)
  const actionUrl = new URL('./realtime-infra-action.txt', import.meta.url)
  const workflowUrl = new URL('../../.github/workflows/aws-realtime-infra.yml', import.meta.url)

  assert.equal(existsSync(classifierUrl), true, 'missing realtime infrastructure plan classifier')
  assert.equal(existsSync(scriptUrl), true, 'missing realtime infrastructure runner')
  assert.equal(existsSync(actionUrl), true, 'missing realtime infrastructure action guard')
  assert.equal(existsSync(workflowUrl), true, 'missing realtime infrastructure workflow')

  const expectedCreateResources = [
    'random_password.realtime_ticket',
    'aws_secretsmanager_secret.realtime_ticket',
    'aws_secretsmanager_secret_version.realtime_ticket',
    'aws_iam_role_policy.ecs_execution_realtime_ticket_secret',
    'aws_dynamodb_table.realtime_connections',
    'aws_sqs_queue.realtime_dlq',
    'aws_sqs_queue.realtime_events',
    'aws_cloudwatch_event_rule.realtime_events',
    'aws_cloudwatch_event_target.realtime_queue',
    'aws_sqs_queue_policy.realtime_events',
    'aws_iam_role.realtime_authorizer',
    'aws_iam_role.realtime_connection',
    'aws_iam_role.realtime_fanout',
    'aws_iam_role_policy_attachment.realtime_authorizer_logs',
    'aws_iam_role_policy_attachment.realtime_connection_logs',
    'aws_iam_role_policy_attachment.realtime_fanout_logs',
    'aws_iam_role_policy.realtime_authorizer',
    'aws_iam_role_policy.realtime_connection',
    'aws_iam_role_policy.realtime_fanout',
    'aws_cloudwatch_log_group.realtime_authorizer',
    'aws_cloudwatch_log_group.realtime_connection',
    'aws_cloudwatch_log_group.realtime_fanout',
    'aws_lambda_function.realtime_authorizer',
    'aws_lambda_function.realtime_connection',
    'aws_apigatewayv2_api.realtime',
    'aws_lambda_permission.realtime_authorizer_apigateway',
    'aws_apigatewayv2_authorizer.realtime_connect',
    'aws_apigatewayv2_integration.realtime_connection',
    'aws_apigatewayv2_route.realtime_connect',
    'aws_apigatewayv2_route.realtime_disconnect',
    'aws_apigatewayv2_route.realtime_default',
    'aws_lambda_permission.realtime_connection_apigateway',
    'aws_cloudwatch_log_group.realtime_api',
    'aws_iam_role.realtime_api_gateway_logs',
    'aws_iam_role_policy_attachment.realtime_api_gateway_logs',
    'aws_api_gateway_account.realtime',
    'aws_apigatewayv2_stage.realtime',
    'aws_lambda_function.realtime_fanout',
    'aws_lambda_event_source_mapping.realtime_events',
    'aws_cloudwatch_metric_alarm.realtime_dlq_depth',
    'aws_cloudwatch_metric_alarm.realtime_queue_age',
  ]

  const classifier = await import(classifierUrl.href)
  assert.deepEqual(
    new Set(classifier.REALTIME_INFRA_CREATE_RESOURCES),
    new Set(expectedCreateResources),
  )
  assert.equal(classifier.REALTIME_WEB_TASK_RESOURCE, 'aws_ecs_task_definition.web')

  const createPlan = {
    resource_changes: [
      ...expectedCreateResources.map((address) => ({
        address,
        mode: 'managed',
        change: { actions: ['create'] },
      })),
      {
        address: 'aws_ecs_task_definition.web',
        mode: 'managed',
        change: { actions: ['create', 'delete'] },
      },
    ],
  }

  assert.deepEqual(classifier.classifyRealtimeInfraPlan(createPlan, 'plan'), {
    mode: 'create',
    createCount: expectedCreateResources.length,
    replaceCount: 1,
  })
  assert.deepEqual(classifier.classifyRealtimeInfraPlan({ resource_changes: [] }, 'plan'), {
    mode: 'steady',
    createCount: 0,
    replaceCount: 0,
  })
  assert.throws(
    () => classifier.classifyRealtimeInfraPlan({ resource_changes: [] }, 'apply-once'),
    /apply-once requires the initial realtime infrastructure plan/,
  )
  assert.throws(
    () => classifier.classifyRealtimeInfraPlan({
      resource_changes: [{ address: 'aws_vpc.app', mode: 'managed', change: { actions: ['update'] } }],
    }, 'plan'),
    /Unexpected actual change outside realtime allowlist/,
  )
  assert.throws(
    () => classifier.classifyRealtimeInfraPlan({
      resource_changes: [{
        address: 'aws_dynamodb_table.realtime_connections',
        mode: 'managed',
        change: { actions: ['update'] },
      }],
    }, 'plan'),
    /Expected create-only realtime resource change/,
  )

  assert.ok(['plan', 'apply-once'].includes((await readFile(actionUrl, 'utf8')).trim()))

  const script = await readFile(scriptUrl, 'utf8')
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"/)
  assert.match(script, /realtime-infra-action\.txt/)
  assert.match(script, /realtime-infra-plan-classifier\.mjs/)
  assert.match(script, /plan\|apply-once/)
  assert.match(script, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)
  assert.match(script, /terraform[^\n]+init/)
  assert.doesNotMatch(script, /-plugin-dir/)
  assert.doesNotMatch(script, /-lockfile=readonly/)
  assert.match(script, /['"]registry\.terraform\.io\/hashicorp\/aws['"]\s*:\s*['"]6\.62\.0['"]/)
  assert.match(script, /['"]registry\.terraform\.io\/hashicorp\/archive['"]\s*:\s*['"]2\.8\.1['"]/)
  assert.match(script, /['"]registry\.terraform\.io\/hashicorp\/random['"]\s*:\s*['"]3\.9\.1['"]/)
  assert.match(script, /REALTIME_PROVIDER_LOCK_VERIFIED=true/)
  assert.match(script, /terraform[^\n]+plan/)
  assert.match(script, /terraform[^\n]+apply/)
  assert.match(script, /aws apigatewayv2 get-api/)
  assert.match(script, /aws dynamodb describe-table/)
  assert.match(script, /aws sqs get-queue-url/)
  assert.match(script, /aws lambda get-function/)
  assert.match(script, /REALTIME_INFRA_APPLY_VERIFIED=true/)

  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /name: AWS Realtime Messaging Infrastructure/)
  assert.match(workflow, /branches:\s*\n\s*- feat\/aws-native-phase-0-1/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /role-to-assume: \$\{\{ vars\.AWS_ROLE_TO_ASSUME \}\}/)
  assert.match(workflow, /aws ssm send-command/)
  assert.match(workflow, /REALTIME_INFRA_EXPECTED_SHA/)
  assert.match(workflow, /bash scripts\/aws\/realtime-infra\.sh/)
  assert.match(workflow, /json\.dumps\(\{"executionTimeout"/)
  assert.doesNotMatch(workflow, /json\.dumps\(\{\{/)
  assert.doesNotMatch(workflow, /terraform\s+-chdir=/)
})
