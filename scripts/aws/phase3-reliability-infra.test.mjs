// Round 14 Phase 3 (3.5, 3.11): guarded release path and Terraform contract for the Aurora floor,
// backups, final snapshot, Performance Insights and web log retention.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const script = await read('./phase3-reliability-infra.sh')
const action = guardAction(await read('./phase3-reliability-infra-action.txt'))
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

// Runs the runner's own plan classifier against a synthetic plan.
const classifierStart = script.indexOf(`python3 - "$WORK_DIR/plan.json" <<'PY'\n`)
const classifier = script.slice(script.indexOf('\n', classifierStart) + 1, script.indexOf('\nPY\n', classifierStart))

const auroraChange = (scaling, overrides = {}, beforeOverrides = {}) => ({
  address: 'aws_rds_cluster.aurora',
  mode: 'managed',
  change: {
    actions: ['update'],
    before: { backup_retention_period: 7, deletion_protection: true, serverlessv2_scaling_configuration: [{ min_capacity: 0, max_capacity: 4, seconds_until_auto_pause: 900 }], ...beforeOverrides },
    after: { backup_retention_period: 14, deletion_protection: true, serverlessv2_scaling_configuration: scaling, ...overrides },
    after_unknown: {},
  },
})
const logGroupChange = {
  address: 'aws_cloudwatch_log_group.app',
  mode: 'managed',
  change: { actions: ['update'], before: { retention_in_days: 14 }, after: { retention_in_days: 90 }, after_unknown: {} },
}

async function classify(resourceChanges) {
  const dir = await mkdtemp(join(tmpdir(), 'phase3-plan-'))
  try {
    const planPath = join(dir, 'plan.json')
    await writeFile(planPath, JSON.stringify({ resource_changes: resourceChanges }))
    return spawnSync('python3', ['-', planPath], { input: classifier, encoding: 'utf8' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('the plan check accepts the 0.5 ACU floor even though the stored pause timer stays in the plan', async () => {
  assert.ok(classifier.includes('allowed = {'))
  const result = await classify([auroraChange([{ min_capacity: 0.5, max_capacity: 4, seconds_until_auto_pause: 900 }]), logGroupChange])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /PHASE3_RELIABILITY_PLAN_CHANGES=2/)
  assert.match(result.stdout, /AURORA_PLANNED_MIN_ACU=0\.5 AURORA_PLANNED_PAUSE_TIMER_IGNORED=900/)
})

test('the plan check still refuses a floor of 0, a missing floor, deletion protection off or a replace', async () => {
  const refusals = [
    [[auroraChange([{ min_capacity: 0, max_capacity: 4, seconds_until_auto_pause: 900 }])], /0\.5 ACU floor/],
    [[auroraChange([{ min_capacity: 0, max_capacity: 4 }])], /0\.5 ACU floor/],
    [[auroraChange([{ max_capacity: 4, seconds_until_auto_pause: 900 }])], /0\.5 ACU floor/],
    [[auroraChange([])], /0\.5 ACU floor/],
    [[auroraChange(null)], /0\.5 ACU floor/],
    [[auroraChange([{ min_capacity: 0.5, max_capacity: 4 }], { deletion_protection: false }, { deletion_protection: false })], /deletion protection must stay on/],
    [[{ ...logGroupChange, change: { ...logGroupChange.change, actions: ['delete', 'create'] } }], /unexpected phase 3 reliability change refused/],
  ]
  for (const [changes, message] of refusals) {
    const result = await classify(changes)
    assert.notEqual(result.status, 0, JSON.stringify(changes))
    assert.match(result.stderr, message)
  }
})

test('the post-apply check still requires the live 0.5 ACU floor', () => {
  assert.match(script, /\.ServerlessV2ScalingConfiguration\.MinCapacity == 0\.5 and/)
  assert.match(script, /\.BackupRetentionPeriod == 14 and \.DeletionProtection == true/)
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
