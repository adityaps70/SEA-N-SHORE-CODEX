import assert from 'node:assert/strict'
import fs from 'node:fs'

const migrations = [
  '0055_community_groups_tagging',
  '0056_community_tagging_notifications',
]
const script = fs.readFileSync('scripts/aws/round-9b-migration.sh', 'utf8')
const guard = fs.readFileSync('scripts/aws/round-9b-migration-action.txt', 'utf8').trim()
const workflow = fs.readFileSync('.github/workflows/aws-round-9b-migration.yml', 'utf8')

assert.ok(['plan', 'migrate-once'].includes(guard))
for (const name of migrations) {
  const path = `infra/aws/database/migrations/${name}.sql`
  const sql = fs.readFileSync(path, 'utf8')
  assert.ok(script.includes(path), `script applies ${name}`)
  assert.ok(workflow.includes(path), `workflow watches ${name}`)
  assert.match(sql, /-- statement-breakpoint/, `${name} is split into statements`)
  const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(code, /\bdrop\s+(table|column|type|schema)\b/i, `${name} drops nothing`)
  assert.doesNotMatch(code, /\btruncate\b/i, `${name} truncates nothing`)
  assert.doesNotMatch(code, /\bdelete\s+from\b/i, `${name} deletes no rows`)
  assert.doesNotMatch(code, /\bconcurrently\b/i, `${name} is transaction-safe`)
}
// Files must be applied in numeric order.
const order = migrations.map((name) => script.indexOf(name))
assert.deepEqual([...order].sort((a, b) => a - b), order)

assert.match(script, /310356785722/)
assert.match(script, /ROUND_9B_MIGRATION_EXPECTED_SHA/)
assert.match(script, /plan\|migrate-once/)
assert.match(script, /begin-transaction/)
assert.match(script, /commit-transaction/)
assert.match(script, /rollback-transaction/)
assert.match(script, /pg_advisory_xact_lock/)
assert.match(script, /sea_n_shore_applied_migrations/)
assert.match(script, /ROUND_9B_MIGRATION_PLAN_ONLY_NO_APPLY/)
assert.match(script, /ROUND_9B_MIGRATION_APPLY_VERIFIED=true/)
assert.match(script, /ROUND_9B_MIGRATION_ALREADY_APPLIED=true/)
assert.match(script, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)

assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
assert.match(workflow, /Guard migration against a moved branch/)
assert.match(workflow, /environment:\s*staging/)
assert.match(workflow, /ROUND_9B_MIGRATION_EXPECTED_SHA/)
assert.match(workflow, /I_APPROVE_ROUND_9B_STAGING_MIGRATION/)
assert.match(workflow, /bash scripts\/aws\/round-9b-migration\.sh/)
assert.doesNotMatch(workflow, /membership/i)
assert.match(script, /ROUND_9B_MIGRATION_ACTION/)
assert.match(workflow, /ROUND_9B_MIGRATION_ACTION/)

// Round 9B tables and the new notification types.
const groups = fs.readFileSync('infra/aws/database/migrations/0055_community_groups_tagging.sql', 'utf8')
for (const fragment of [
  'create table if not exists public.community_groups',
  'create table if not exists public.community_group_memberships',
  'alter table public.posts add column if not exists group_id uuid',
  'create table if not exists public.content_organization_mentions',
  'create table if not exists public.post_photo_tags',
  'create table if not exists public.hashtags',
  'create table if not exists public.post_hashtags',
  'create table if not exists public.hashtag_follows',
  "target_type in ('post', 'comment', 'job', 'event', 'profile', 'group')",
  "'tanker-professionals'",
  "'masters-senior-officers'",
  "'marine-engineers'",
  "'cadets-community'",
  "'ask-the-community'",
]) {
  assert.ok(groups.includes(fragment), `0055 contains ${fragment}`)
}
const notification = fs.readFileSync('infra/aws/database/migrations/0056_community_tagging_notifications.sql', 'utf8')
for (const type of ['group_join_request', 'group_join_approved', 'group_post', 'organization_mention', 'photo_tag']) {
  assert.match(notification, new RegExp(`alter type public\\.network_notification_type add value if not exists '${type}';`), `0056 adds ${type}`)
}

console.log('ROUND_9B_MIGRATION_CONTRACT_VERIFIED=true')
