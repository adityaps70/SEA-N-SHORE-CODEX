import assert from 'node:assert/strict'
import fs from 'node:fs'

const migrations = [
  '0057_community_images_join_policy',
]
const script = fs.readFileSync('scripts/aws/round-9c-migration.sh', 'utf8')
const guard = fs.readFileSync('scripts/aws/round-9c-migration-action.txt', 'utf8').trim()
const workflow = fs.readFileSync('.github/workflows/aws-round-9c-migration.yml', 'utf8')

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
assert.match(script, /ROUND_9C_MIGRATION_EXPECTED_SHA/)
assert.match(script, /plan\|migrate-once/)
assert.match(script, /begin-transaction/)
assert.match(script, /commit-transaction/)
assert.match(script, /rollback-transaction/)
assert.match(script, /pg_advisory_xact_lock/)
assert.match(script, /sea_n_shore_applied_migrations/)
assert.match(script, /ROUND_9C_MIGRATION_PLAN_ONLY_NO_APPLY/)
assert.match(script, /ROUND_9C_MIGRATION_APPLY_VERIFIED=true/)
assert.match(script, /ROUND_9C_MIGRATION_ALREADY_APPLIED=true/)
assert.match(script, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)

assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
assert.match(workflow, /Guard migration against a moved branch/)
assert.match(workflow, /environment:\s*staging/)
assert.match(workflow, /ROUND_9C_MIGRATION_EXPECTED_SHA/)
assert.match(workflow, /I_APPROVE_ROUND_9C_STAGING_MIGRATION/)
assert.match(workflow, /bash scripts\/aws\/round-9c-migration\.sh/)
assert.doesNotMatch(workflow, /membership/i)
assert.match(script, /ROUND_9C_MIGRATION_ACTION/)
assert.match(workflow, /ROUND_9C_MIGRATION_ACTION/)

// Round 9C columns.
const migration = fs.readFileSync('infra/aws/database/migrations/0057_community_images_join_policy.sql', 'utf8')
for (const fragment of [
  'alter table public.community_groups add column if not exists icon_path text',
  'alter table public.community_groups add column if not exists owner_company_id uuid references public.companies(id) on delete set null',
  "alter table public.community_groups add column if not exists join_policy text not null default 'open'",
  "check (join_policy in ('open', 'approval'))",
  "set join_policy = 'approval'",
]) {
  assert.ok(migration.includes(fragment), `0057 contains ${fragment}`)
}

console.log('ROUND_9C_MIGRATION_CONTRACT_VERIFIED=true')
