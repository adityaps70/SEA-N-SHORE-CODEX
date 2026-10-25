import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

// Round P3 (B9): installing pg_stat_statements on production Aurora. The only change the runner can
// make is CREATE EXTENSION IF NOT EXISTS pg_stat_statements, and only without a reboot.
const actionPath = 'scripts/aws/pg-stat-statements-action.txt'
const workflowPath = '.github/workflows/aws-pg-stat-statements.yml'
const wrapperPath = 'scripts/aws/pg-stat-statements.cjs'
const remotePath = 'scripts/aws/pg-stat-statements-remote.py'

test('the runner is staging-only, exact-head and armed by an owner-merged guard', () => {
  for (const path of [actionPath, workflowPath, wrapperPath, remotePath]) assert.equal(existsSync(path), true, `${path} must exist`)
  const action = guardAction(readFileSync(actionPath, 'utf8'))
  assert.ok(['plan', 'install-once'].includes(action), `Unexpected pg_stat_statements action: ${action}`)
  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /feat\/aws-native-phase-0-1/)
  assert.match(workflow, /bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(workflow, /environment:\s*staging\n/)
  assert.match(workflow, /environment:\s*staging-apply\n/)
  assert.match(workflow, /Guard against a moved branch/)
  assert.match(workflow, /310356785722/)
  assert.match(workflow, /node --test scripts\/aws\/pg-stat-statements-guard\.test\.mjs/)
  assert.match(workflow, /plan\|discover\) echo "approval=false"/)
  assert.match(workflow, /install-once\)\n\s+\[\[ "\$GITHUB_EVENT_NAME" == push \]\]/)
  assert.match(workflow, /PGSS_ACTION: install/)
})

test('the SSM wrapper only sends the script and reads its result', () => {
  const wrapper = readFileSync(wrapperPath, 'utf8')
  const calls = [...wrapper.matchAll(/'(ssm|ecs|rds|rds-data|s3|s3api|ec2|lambda|iam)', '([a-z-]+)'/g)].map((m) => `${m[1]} ${m[2]}`)
  assert.deepEqual([...new Set(calls)].sort(), ['ssm get-command-invocation', 'ssm send-command'])
  assert.match(wrapper, /pg-stat-statements-remote\.py/)
})

test('the remote script makes one change only: CREATE EXTENSION, and only when Aurora preloads the library', () => {
  const remote = readFileSync(remotePath, 'utf8')
  const calls = [...remote.matchAll(/aws\("([a-z0-9-]+)", "([a-z-]+)"/g)].map((m) => `${m[1]} ${m[2]}`)
  assert.deepEqual([...new Set(calls)].sort(), ['rds describe-db-clusters', 'rds-data execute-statement'])
  const statements = [...remote.matchAll(/"((?:show|select|create)[^"]*)"/g)].map((m) => m[1])
  assert.deepEqual(statements, [
    'show shared_preload_libraries',
    "select extversion from pg_extension where extname = 'pg_stat_statements'",
    'select count(*) as statements from pg_stat_statements',
    'create extension if not exists pg_stat_statements',
  ])
  assert.match(remote, /assert statement in READ_STATEMENTS or statement == INSTALL_STATEMENT/)
  // Without the preloaded library it stops before any change: no parameter group edits, no reboot.
  assert.match(remote, /if not preloaded:\n\s+out\("PGSS_REBOOT_REQUIRED=true[^\n]*\n\s+return 3/)
  assert.match(remote, /if not INSTALL:\n\s+out\("PGSS_PLAN_ONLY_NO_CHANGE"\)/)
  assert.doesNotMatch(remote, /reboot-db|modify-db|parameter-group|drop |alter |delete |update |insert /i)
  // Output is versions and counts, never query text.
  assert.doesNotMatch(remote, /select query|\bquery\b from pg_stat_statements/i)
})
