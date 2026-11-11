// Round 13: guarded release path for web scaling (min 2), memory policy, alarms and OOM alerts.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const script = await read('./web-resilience-infra.sh')
const action = guardAction(await read('./web-resilience-infra-action.txt'))
const workflow = await read('../../.github/workflows/aws-web-resilience-infra.yml')
const terraform = await read('../../infra/aws/app/web-resilience.tf')
const main = await read('../../infra/aws/app/main.tf')

test('web resilience runner is guarded, targeted and refuses anything outside its resources', () => {
  assert.ok(['plan', 'apply-once'].includes(action))
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /WEB_RESILIENCE_INFRA_EXPECTED_SHA/)
  assert.match(script, /case "\$ACTION" in plan\|apply-once\)/)
  assert.match(script, /unexpected web resilience change refused/)
  assert.match(script, /scaling target change outside min\/max refused/)
  assert.match(script, /'aws_appautoscaling_policy\.memory': \{\('create',\)\}/)
  assert.match(script, /'aws_appautoscaling_target\.web': \{\('update',\)\}/)
  assert.doesNotMatch(script, /aws_ecs_service\.web|aws_ecs_task_definition\.web\b(?!')|aws_lb\.app/)
  assert.match(script, /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1/)
  assert.match(script, /STATE_BACKUP_VERSION/)
  assert.match(script, /Web resilience resources still drift after apply/)
  assert.match(script, /WEB_SCALING_VERIFIED min=2 max=8 policies=cpu,memory,requests steps=requests-burst,cpu-burst/)
  assert.match(script, /OOM_EVENT_RULE_VERIFIED=true/)
  assert.match(script, /WEB_RESILIENCE_APPLY_VERIFIED=true/)
  assert.doesNotMatch(script, /-auto-approve/)
})

test('Round 13 Terraform keeps two tasks, scales on memory and alerts the owner', () => {
  assert.match(main, /variable "task_memory"[\s\S]*?default\s*=\s*2048/)
  assert.match(main, /variable "desired_count"[\s\S]*?default\s*=\s*2/)
  assert.match(main, /variable "min_capacity"[\s\S]*?default\s*=\s*2/)
  assert.match(main, /variable "max_capacity"[\s\S]*?default\s*=\s*8/)
  assert.match(main, /resource_id\s*=\s*"service\/\$\{local\.name_prefix\}\/\$\{local\.name_prefix\}-web"/)
  assert.match(terraform, /predefined_metric_type = "ECSServiceAverageMemoryUtilization"/)
  assert.match(terraform, /target_value\s*=\s*70/)
  assert.match(terraform, /protocol\s*=\s*"email"/)
  for (const alarm of ['web_memory_high', 'web_running_tasks_low', 'alb_gateway_errors', 'alb_target_connection_errors']) {
    const block = terraform.slice(terraform.indexOf(`"aws_cloudwatch_metric_alarm" "${alarm}"`))
    assert.match(block.slice(0, 2500), /alarm_actions\s*=\s*\[aws_sns_topic\.alerts\.arn\]/, alarm)
  }
  // Round DB (cost): with Container Insights off, the running-tasks alarm counts healthy web targets behind the ALB
  // (fewer than 2 for 5 minutes still pages), and the ephemeral storage alarm, which needed Container Insights, is gone.
  const running = terraform.slice(terraform.indexOf('"aws_cloudwatch_metric_alarm" "web_running_tasks_low"'), terraform.indexOf('"aws_cloudwatch_metric_alarm" "alb_gateway_errors"'))
  assert.match(running, /namespace\s*=\s*"AWS\/ApplicationELB"\n\s*metric_name\s*=\s*"HealthyHostCount"/)
  assert.match(running, /dimensions\s*=\s*\{ TargetGroup = aws_lb_target_group\.app\.arn_suffix, LoadBalancer = local\.alb_dimension \}/)
  assert.match(running, /statistic\s*=\s*"Minimum"[\s\S]*period\s*=\s*60[\s\S]*evaluation_periods\s*=\s*5[\s\S]*threshold\s*=\s*2[\s\S]*"LessThanThreshold"[\s\S]*treat_missing_data\s*=\s*"breaching"/)
  assert.doesNotMatch(terraform, /ECS\/ContainerInsights|resource "aws_cloudwatch_metric_alarm" "web_ephemeral_storage_high"/)
  assert.doesNotMatch(script, /web_ephemeral_storage_high|web-ephemeral-storage-high/)
  assert.match(terraform, /threshold\s*=\s*80/)
  assert.match(terraform, /HTTPCode_ELB_502_Count/)
  assert.match(terraform, /TargetConnectionErrorCount/)
  assert.match(terraform, /reason = \[\{ prefix = "OutOfMemoryError" \}\]/)
  assert.doesNotMatch(terraform, /aws_ecs_service\.web|aws_ecs_cluster\.app|aws_lb\.app/)
})

test('web resilience workflow waits for exact-head CI and runs the pinned commit', () => {
  assert.match(workflow, /name: AWS Web Resilience Infrastructure/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Guard infrastructure operation against a moved branch/)
  assert.match(workflow, /export WEB_RESILIENCE_INFRA_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /bash scripts\/aws\/web-resilience-infra\.sh/)
  assert.match(workflow, /apply-once is allowed only from an exact branch push/)
})

test('Round H (H1) adds operations alerts: app 5xx rate, CPU, per-API server errors and site health', () => {
  assert.match(terraform, /variable "operations_alert_email"[\s\S]*?default\s*=\s*"info@beaufortmarine\.in"/)
  assert.match(terraform, /resource "aws_sns_topic_subscription" "alerts_operations_email"/)
  assert.match(terraform, /HTTPCode_Target_5XX_Count/)
  assert.match(terraform, /metric_name\s*=\s*"CPUUtilization"/)
  assert.match(terraform, /namespace\s*=\s*"SeaNShore\/App"[\s\S]*?metric_name\s*=\s*"ServerErrors"/)
  // Only a failed check pages; a pause in the probe (missing data) never alarms while the site is up.
  assert.match(terraform, /metric_name\s*=\s*"SiteUp"[\s\S]*?treat_missing_data\s*=\s*"notBreaching"/)
  for (const area of ['feed', 'impressions', 'messaging', 'jobs', 'learning', 'payments-webhooks']) {
    assert.match(terraform, new RegExp(`"${area}"`), area)
    assert.match(script, new RegExp(`api-${area}-server-errors`), area)
  }
  for (const alarm of ['alb_target_5xx_rate', 'web_cpu_high', 'api_server_errors', 'site_health']) {
    const block = terraform.slice(terraform.indexOf(`"aws_cloudwatch_metric_alarm" "${alarm}"`))
    assert.match(block.slice(0, 2500), /alarm_actions\s*=\s*\[aws_sns_topic\.alerts\.arn\]/, alarm)
    assert.match(script, new RegExp(`aws_cloudwatch_metric_alarm\\.${alarm}`), alarm)
  }
  // Instances of the per-area alarms may only be created, and only for the known areas and checks.
  assert.match(script, /allowed_instances = \{/)
  assert.match(script, /r\.get\('index'\) not in allowed_instances\[base\] or actions != \('create',\)/)
  // The one exception: a site check may be updated in place, only to switch treat_missing_data to notBreaching.
  assert.match(script, /base == 'aws_cloudwatch_metric_alarm\.site_health' and r\.get\('index'\) in allowed_instances\[base\] and actions == \('update',\)/)
  assert.match(script, /if changed != \['treat_missing_data'\] or after\.get\('treat_missing_data'\) != 'notBreaching':/)
  assert.match(script, /site health alarm change outside treat_missing_data refused/)
  // After apply, both site checks really read notBreaching.
  assert.match(script, /select\(\.TreatMissingData == "notBreaching"\)\] \| length == 1/)
  assert.match(script, /SITE_HEALTH_MISSING_DATA_VERIFIED=/)
  assert.match(script, /site-home-down site-api-health-down/)
})

test('Round P3 scales on requests per task up to 8, adds burst steps, pages on p95, Lambda throttles and CPU 70%/10 min, and caps MediaConvert', () => {
  // Requests per task as well as CPU and memory; one-minute burst steps add tasks before target tracking reacts.
  assert.match(terraform, /resource "aws_appautoscaling_policy" "requests"[\s\S]*?target_value\s*=\s*400[\s\S]*?predefined_metric_type = "ALBRequestCountPerTarget"/)
  assert.match(terraform, /resource_label\s*=\s*"\$\{local\.alb_dimension\}\/\$\{local\.web_target_group_dimension\}"/)
  assert.match(terraform, /resource "aws_cloudwatch_metric_alarm" "web_requests_burst"[\s\S]*?period\s*=\s*60[\s\S]*?threshold\s*=\s*600[\s\S]*?alarm_actions\s*=\s*\[aws_appautoscaling_policy\.requests_burst\.arn\]/)
  assert.match(terraform, /resource "aws_cloudwatch_metric_alarm" "web_cpu_burst"[\s\S]*?period\s*=\s*60[\s\S]*?alarm_actions\s*=\s*\[aws_appautoscaling_policy\.cpu_burst\.arn\]/)
  // Owner alarms.
  assert.match(terraform, /resource "aws_cloudwatch_metric_alarm" "web_cpu_high"[\s\S]*?period\s*=\s*300\n\s*evaluation_periods\s*=\s*2\n\s*threshold\s*=\s*70/)
  assert.match(terraform, /resource "aws_cloudwatch_metric_alarm" "web_latency_p95"[\s\S]*?metric_name\s*=\s*"TargetResponseTime"[\s\S]*?extended_statistic\s*=\s*"p95"[\s\S]*?threshold\s*=\s*1\n/)
  assert.match(terraform, /resource "aws_cloudwatch_metric_alarm" "lambda_throttles"[\s\S]*?namespace\s*=\s*"AWS\/Lambda"[\s\S]*?metric_name\s*=\s*"Throttles"/)
  for (const alarm of ['web_latency_p95', 'lambda_throttles']) {
    const block = terraform.slice(terraform.indexOf(`"aws_cloudwatch_metric_alarm" "${alarm}"`))
    assert.match(block.slice(0, 1500), /alarm_actions\s*=\s*\[aws_sns_topic\.alerts\.arn\]/, alarm)
  }
  // About ₹1,000 a month on MediaConvert only, emailed at 80% forecast and 100% actual.
  assert.match(terraform, /resource "aws_budgets_budget" "mediaconvert"[\s\S]*?limit_amount\s*=\s*"11\.40"[\s\S]*?values\s*=\s*\["AWS Elemental MediaConvert"\]/)
  // The runner creates only these, updates the CPU alarm only to 70%/10 min and the target only to 2..8, and verifies live.
  for (const address of ['aws_appautoscaling_policy.requests', 'aws_appautoscaling_policy.requests_burst', 'aws_cloudwatch_metric_alarm.web_requests_burst', 'aws_appautoscaling_policy.cpu_burst', 'aws_cloudwatch_metric_alarm.web_cpu_burst', 'aws_cloudwatch_metric_alarm.web_latency_p95', 'aws_cloudwatch_metric_alarm.lambda_throttles']) {
    assert.ok(script.includes(`'${address}': {('create',)}`), address)
    assert.ok(script.includes(`  ${address}\n`), address)
  }
  // The budget may also be updated, but only to move its emails (see the owner-inbox test below).
  assert.ok(script.includes(`'aws_budgets_budget.mediaconvert': {('create',), ('update',)}`))
  assert.ok(script.includes('  aws_budgets_budget.mediaconvert\n'))
  assert.match(script, /web CPU alarm change outside 70% for 10 minutes refused/)
  assert.match(script, /scaling target must be min 2 max 8/)
  assert.match(script, /MediaConvert budget must filter on the MediaConvert service only/)
  assert.match(script, /MEDIACONVERT_BUDGET_VERIFIED/)
  assert.match(script, /BURST_ALARM_VERIFIED=/)
  assert.match(script, /web-latency-p95 lambda-throttles/)
})

test('Round P3: the operations inbox moves from operations@ to info@beaufortmarine.in, and nothing else may change with it', () => {
  assert.doesNotMatch(terraform, /operations@beaufortmarine\.in"/)
  assert.match(terraform, /resource "aws_budgets_budget" "mediaconvert"[\s\S]*?subscriber_email_addresses = \[var\.alert_email, var\.operations_alert_email\]/)
  // A subscription endpoint change replaces it; only this exact move is accepted.
  assert.ok(script.includes(`'aws_sns_topic_subscription.alerts_operations_email': {('create',), ('delete', 'create'), ('create', 'delete')}`))
  assert.match(script, /operations alert subscription may only move from operations@ to info@beaufortmarine\.in/)
  assert.match(script, /MediaConvert budget update may only move its emails to info@beaufortmarine\.in/)
  // After apply: info@ is subscribed and operations@ is gone.
  assert.match(script, /index\("info@beaufortmarine\.in"\) != null\) and \(\[\.Subscriptions\[\]\.Endpoint\] \| index\("operations@beaufortmarine\.in"\) == null\)/)
  assert.match(script, /OPERATIONS_ALERT_INBOX_VERIFIED=info@beaufortmarine\.in/)
})

