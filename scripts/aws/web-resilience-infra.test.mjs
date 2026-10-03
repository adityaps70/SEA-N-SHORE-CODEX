// Round 13: guarded release path for web scaling (min 2), memory policy, alarms and OOM alerts.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const script = await read('./web-resilience-infra.sh')
const action = (await read('./web-resilience-infra-action.txt')).trim()
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
  assert.match(script, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)
  assert.match(script, /STATE_BACKUP_VERSION/)
  assert.match(script, /Web resilience resources still drift after apply/)
  assert.match(script, /WEB_SCALING_VERIFIED min=2 max=4 policies=cpu,memory/)
  assert.match(script, /OOM_EVENT_RULE_VERIFIED=true/)
  assert.match(script, /WEB_RESILIENCE_APPLY_VERIFIED=true/)
  assert.doesNotMatch(script, /-auto-approve/)
})

test('Round 13 Terraform keeps two tasks, scales on memory and alerts the owner', () => {
  assert.match(main, /variable "task_memory"[\s\S]*?default\s*=\s*2048/)
  assert.match(main, /variable "desired_count"[\s\S]*?default\s*=\s*2/)
  assert.match(main, /variable "min_capacity"[\s\S]*?default\s*=\s*2/)
  assert.match(main, /variable "max_capacity"[\s\S]*?default\s*=\s*4/)
  assert.match(main, /resource_id\s*=\s*"service\/\$\{local\.name_prefix\}\/\$\{local\.name_prefix\}-web"/)
  assert.match(terraform, /predefined_metric_type = "ECSServiceAverageMemoryUtilization"/)
  assert.match(terraform, /target_value\s*=\s*70/)
  assert.match(terraform, /protocol\s*=\s*"email"/)
  for (const alarm of ['web_memory_high', 'web_running_tasks_low', 'alb_gateway_errors', 'alb_target_connection_errors', 'web_ephemeral_storage_high']) {
    const block = terraform.slice(terraform.indexOf(`"aws_cloudwatch_metric_alarm" "${alarm}"`))
    assert.match(block.slice(0, 2500), /alarm_actions\s*=\s*\[aws_sns_topic\.alerts\.arn\]/, alarm)
  }
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
