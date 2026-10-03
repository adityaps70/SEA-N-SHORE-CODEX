import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflowPath = '.github/workflows/aws-post-reposts-migration.yml'
const runnerPath = 'scripts/aws/post-reposts-migration.sh'
const actionPath = 'scripts/aws/post-reposts-migration-action.txt'
const migrationPath = 'infra/aws/database/migrations/0015_post_reposts.sql'

test('post repost migration is guarded, exact-head and one-shot', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const runner = readFileSync(runnerPath, 'utf8')
  const action = readFileSync(actionPath, 'utf8').trim()

  assert.ok(['plan', 'apply-once'].includes(action), `Unexpected post repost migration action: ${action}`)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- feat\/aws-native-phase-0-1/)
  assert.match(workflow, /scripts\/aws\/post-reposts-migration-action\.txt/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Exact-head AWS Infrastructure CI is not green/)
  assert.match(workflow, /aws-actions\/configure-aws-credentials@v4/)
  assert.match(workflow, /POST_REPOSTS_MIGRATION_EXPECTED_SHA/)
  assert.match(workflow, /bash scripts\/aws\/post-reposts-migration\.sh/)

  assert.match(runner, /EXPECTED_ACCOUNT="310356785722"/)
  assert.doesNotMatch(runner, /992382634586/)
  assert.match(runner, /0015_post_reposts\.sql/)
  assert.match(runner, /case "\$ACTION" in plan\|apply-once/)
  assert.match(runner, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)
  assert.match(runner, /ENUM_VALUES/)
  assert.match(runner, /REPOST_COLUMN/)
  assert.match(runner, /REPOST_CONSTRAINTS/)
  assert.match(runner, /REPOST_INDEXES/)
  assert.match(runner, /Partial or unexpected post repost schema detected/)
  assert.match(runner, /POST_REPOSTS_MIGRATION_PLAN_ONLY_NO_APPLY/)
  assert.match(runner, /POST_REPOSTS_MIGRATION_ALREADY_APPLIED=true/)
  assert.match(runner, /POST_REPOSTS_MIGRATION_APPLY_VERIFIED=true/)
})

test('enum value is committed before transactional schema statements use repost', () => {
  const runner = readFileSync(runnerPath, 'utf8')
  const enumPosition = runner.indexOf('POST_REPOSTS_ENUM_COMMITTED=true')
  const beginPosition = runner.indexOf('begin-transaction')
  assert.ok(enumPosition >= 0, 'enum commit marker is missing')
  assert.ok(beginPosition > enumPosition, 'transactional schema apply must start only after enum value is committed')
  assert.match(runner, /alter type public\.post_type add value if not exists 'repost'/i)
  assert.match(runner, /begin-transaction/)
  assert.match(runner, /--transaction-id/)
  assert.match(runner, /rollback-transaction/)
  assert.match(runner, /commit-transaction/)
})

test('post repost migration is additive and enforces canonical repost shape', () => {
  const sql = readFileSync(migrationPath, 'utf8').toLowerCase()
  const normalized = sql.replace(/\s+/g, ' ')

  assert.doesNotMatch(sql, /\btruncate\b|\bdelete\s+from\b|\bupdate\s+public\./i)
  assert.match(normalized, /alter type public\.post_type add value if not exists 'repost'/)
  assert.match(normalized, /add column repost_of_post_id uuid references public\.posts\(id\) on delete cascade/)
  assert.match(normalized, /post_type = 'repost'.*body = ''/)
  assert.match(normalized, /post_type = 'repost'.*repost_of_post_id is not null/)
  assert.match(normalized, /post_type <> 'repost'.*repost_of_post_id is null/)
  assert.match(normalized, /create unique index posts_active_repost_unique_idx.*author_id, repost_of_post_id.*post_type = 'repost'.*deleted_at is null/)
})
