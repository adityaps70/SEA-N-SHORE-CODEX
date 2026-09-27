import assert from 'node:assert/strict'
import fs from 'node:fs'

const migrations = [
  '0046_cashfree_gateway_seller_earnings',
  '0047_course_payment_orders',
  '0048_plan_subscriptions_cashfree',
  '0049_seller_payouts',
]
const script = fs.readFileSync('scripts/aws/round-5-migration.sh', 'utf8')
const guard = fs.readFileSync('scripts/aws/round-5-migration-action.txt', 'utf8').trim()
const workflow = fs.readFileSync('.github/workflows/aws-round-5-migration.yml', 'utf8')

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
assert.match(script, /ROUND_5_MIGRATION_EXPECTED_SHA/)
assert.match(script, /plan\|migrate-once/)
assert.match(script, /begin-transaction/)
assert.match(script, /commit-transaction/)
assert.match(script, /rollback-transaction/)
assert.match(script, /pg_advisory_xact_lock/)
assert.match(script, /sea_n_shore_applied_migrations/)
assert.match(script, /ROUND_5_MIGRATION_PLAN_ONLY_NO_APPLY/)
assert.match(script, /ROUND_5_MIGRATION_APPLY_VERIFIED=true/)
assert.match(script, /ROUND_5_MIGRATION_ALREADY_APPLIED=true/)
assert.match(script, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)

assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
assert.match(workflow, /Guard migration against a moved branch/)
assert.match(workflow, /environment:\s*staging/)
assert.match(workflow, /ROUND_5_MIGRATION_EXPECTED_SHA/)
assert.match(workflow, /I_APPROVE_ROUND_5_STAGING_MIGRATION/)
assert.match(workflow, /bash scripts\/aws\/round-5-migration\.sh/)
assert.doesNotMatch(workflow, /membership/i)
assert.match(script, /ROUND_5_MIGRATION_ACTION/)
assert.match(workflow, /ROUND_5_MIGRATION_ACTION/)

console.log('ROUND_5_MIGRATION_CONTRACT_VERIFIED=true')
