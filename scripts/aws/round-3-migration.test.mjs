import assert from 'node:assert/strict'
import fs from 'node:fs'

const migrations = [
  '0034_job_lifecycle_reliability',
  '0035_event_pricing_payments',
  '0036_newsletter_subscriptions',
  '0037_profile_documents_username_generation',
  '0038_organization_types_and_access_decisions',
  '0039_feed_sharing_threads_hides',
  '0041_learning_course_review_revisions',
]
const script = fs.readFileSync('scripts/aws/round-3-migration.sh', 'utf8')
const guard = fs.readFileSync('scripts/aws/round-3-migration-action.txt', 'utf8').trim()
const workflow = fs.readFileSync('.github/workflows/aws-round-3-migration.yml', 'utf8')

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
assert.match(script, /ROUND_3_MIGRATION_EXPECTED_SHA/)
assert.match(script, /plan\|migrate-once/)
assert.match(script, /begin-transaction/)
assert.match(script, /commit-transaction/)
assert.match(script, /rollback-transaction/)
assert.match(script, /pg_advisory_xact_lock/)
assert.match(script, /sea_n_shore_applied_migrations/)
assert.match(script, /ROUND_3_MIGRATION_PLAN_ONLY_NO_APPLY/)
assert.match(script, /ROUND_3_MIGRATION_APPLY_VERIFIED=true/)
assert.match(script, /ROUND_3_MIGRATION_ALREADY_APPLIED=true/)
assert.match(script, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)

assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
assert.match(workflow, /Guard migration against a moved branch/)
assert.match(workflow, /environment:\s*staging/)
assert.match(workflow, /ROUND_3_MIGRATION_EXPECTED_SHA/)
assert.match(workflow, /I_APPROVE_ROUND_3_STAGING_MIGRATION/)
assert.match(workflow, /bash scripts\/aws\/round-3-migration\.sh/)
assert.doesNotMatch(workflow, /membership/i)

console.log('ROUND_3_MIGRATION_CONTRACT_VERIFIED=true')
