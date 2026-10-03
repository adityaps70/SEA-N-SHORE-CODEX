import assert from 'node:assert/strict'
import fs from 'node:fs'

const migrations = [
  '0053_plan_prices_half_year_trials',
  '0054_plan_trial_notification',
]
const script = fs.readFileSync('scripts/aws/round-9a-migration.sh', 'utf8')
const guard = fs.readFileSync('scripts/aws/round-9a-migration-action.txt', 'utf8').trim()
const workflow = fs.readFileSync('.github/workflows/aws-round-9a-migration.yml', 'utf8')

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
assert.match(script, /ROUND_9A_MIGRATION_EXPECTED_SHA/)
assert.match(script, /plan\|migrate-once/)
assert.match(script, /begin-transaction/)
assert.match(script, /commit-transaction/)
assert.match(script, /rollback-transaction/)
assert.match(script, /pg_advisory_xact_lock/)
assert.match(script, /sea_n_shore_applied_migrations/)
assert.match(script, /ROUND_9A_MIGRATION_PLAN_ONLY_NO_APPLY/)
assert.match(script, /ROUND_9A_MIGRATION_APPLY_VERIFIED=true/)
assert.match(script, /ROUND_9A_MIGRATION_ALREADY_APPLIED=true/)
assert.match(script, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)

assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
assert.match(workflow, /Guard migration against a moved branch/)
assert.match(workflow, /environment:\s*staging/)
assert.match(workflow, /ROUND_9A_MIGRATION_EXPECTED_SHA/)
assert.match(workflow, /I_APPROVE_ROUND_9A_STAGING_MIGRATION/)
assert.match(workflow, /bash scripts\/aws\/round-9a-migration\.sh/)
assert.doesNotMatch(workflow, /membership/i)
assert.match(script, /ROUND_9A_MIGRATION_ACTION/)
assert.match(workflow, /ROUND_9A_MIGRATION_ACTION/)

// Round 9A prices (paise) and the trial reminder notification type.
const prices = fs.readFileSync('infra/aws/database/migrations/0053_plan_prices_half_year_trials.sql', 'utf8')
for (const row of [
  "('creator_pro'::text, 'month'::text, 9900::bigint)",
  "('creator_pro'::text, 'year'::text, 99900::bigint)",
  "('organization_pro'::text, 'month'::text, 199900::bigint)",
  "('organization_pro'::text, 'half_year'::text, 1000000::bigint)",
  "('organization_pro'::text, 'year'::text, 1499900::bigint)",
]) {
  assert.ok(prices.includes(row), `0053 seeds price row ${row}`)
}
const notification = fs.readFileSync('infra/aws/database/migrations/0054_plan_trial_notification.sql', 'utf8')
assert.match(notification, /alter type public\.network_notification_type add value if not exists 'plan_trial_ending';/, '0054 adds plan_trial_ending')

console.log('ROUND_9A_MIGRATION_CONTRACT_VERIFIED=true')
