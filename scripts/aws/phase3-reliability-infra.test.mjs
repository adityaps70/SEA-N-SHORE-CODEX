// Round 14 Phase 3 (3.5, 3.11): guarded release path and Terraform contract for the Aurora floor,
// backups, final snapshot, Performance Insights and web log retention.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const script = await read('./phase3-reliability-infra.sh')
const action = (await read('./phase3-reliability-infra-action.txt')).trim()
const workflow = await read('../../.github/workflows/aws-phase3-reliability-infra.yml')
const ci = await read('../../.github/workflows/aws-infra-ci.yml')
const database = await read('../../infra/aws/app/database.tf')
const variables = await read('../../infra/aws/app/aws-native-variables.tf')
const main = await read('../../infra/aws/app/main.tf')

test('the runner accepts only in-place updates of exactly the intended attributes', () => {
  assert.ok(['plan', 'apply-once'].includes(action))
  assert.match(script, /PHASE3_RELIABILITY_EXPECTED_SHA/)
  assert.match(script, /unexpected phase 3 reliability change refused/)
  assert.match(script, /change outside its intended attributes refused/)
  const allowList = script.slice(script.indexOf('allowed = {'), script.indexOf('}\nupdate_keys'))
  assert.doesNotMatch(allowList, /'delete'|'create'/)
  assert.match(script, /'aws_rds_cluster\.aurora': \{'serverlessv2_scaling_configuration', 'backup_retention_period', 'skip_final_snapshot', 'final_snapshot_identifier'\}/)
  assert.match(script, /Aurora must end at a 0\.5 ACU floor without auto-pause/)
  assert.match(script, /Aurora deletion protection must stay on/)
  assert.match(script, /AURORA_FLOOR_AND_BACKUPS_VERIFIED=true/)
  assert.match(script, /WEB_LOG_RETENTION_VERIFIED=true/)
  assert.doesNotMatch(script, /-auto-approve/)
  assert.match(workflow, /name: AWS Phase 3 Reliability Infrastructure/)
  assert.match(workflow, /export PHASE3_RELIABILITY_EXPECTED_SHA=\{sha\}/)
  assert.match(ci, /node --test scripts\/aws\/phase3-reliability-infra\.test\.mjs/)
})

test('Aurora keeps a 0.5 ACU floor, 14-day backups, a final snapshot and Performance Insights', () => {
  assert.match(variables, /variable "aurora_min_acu" \{[\s\S]*?default\s*=\s*0\.5/)
  assert.match(database, /seconds_until_auto_pause = var\.aurora_min_acu == 0 \? var\.aurora_auto_pause_seconds : null/)
  assert.match(database, /backup_retention_period\s*=\s*14/)
  assert.match(database, /skip_final_snapshot\s*=\s*false/)
  assert.match(database, /deletion_protection\s*=\s*true/)
  assert.match(database, /performance_insights_enabled\s*=\s*true/)
  assert.match(main, /resource "aws_cloudwatch_log_group" "app" \{[\s\S]*?retention_in_days = 90/)
})
