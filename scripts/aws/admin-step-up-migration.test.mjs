import assert from 'node:assert/strict'
import fs, { readdirSync, readFileSync } from 'node:fs'
import { guardAction } from './guard-value.mjs'

const migrations = [
  '0095_admin_step_up',
]
const script = fs.readFileSync('scripts/aws/admin-step-up-migration.sh', 'utf8')
const guard = guardAction(fs.readFileSync('scripts/aws/admin-step-up-migration-action.txt', 'utf8'))
const workflow = fs.readFileSync('.github/workflows/aws-admin-step-up-migration.yml', 'utf8')

const norm = (text) => text.split(/\s+/).filter(Boolean).join(' ')
const statementsOf = (sql) => sql.split('-- statement-breakpoint')
  .map((part) => part.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
  .filter(Boolean)

// The only statements that may relax a rule or rewrite rows, word for word, each approved by the owner. The runner's
// ALLOWED list holds the same statements.
const APPROVED = [
]

assert.ok(['plan', 'migrate-once'].includes(guard))
const seenApproved = new Set()
for (const name of migrations) {
  const path = `infra/aws/database/migrations/${name}.sql`
  const sql = fs.readFileSync(path, 'utf8')
  assert.ok(script.includes(path), `script applies ${name}`)
  assert.ok(workflow.includes(path), `workflow watches ${name}`)
  assert.match(sql, /-- statement-breakpoint/, `${name} is split into statements`)
  for (const statement of statementsOf(sql)) {
    const flat = norm(statement)
    if (APPROVED.includes(flat)) { seenApproved.add(flat); continue }
    assert.doesNotMatch(statement, /\bdrop\s+(table|column|type|schema|index|function|trigger|constraint)\b/i, `${name} drops nothing: ${flat.slice(0, 80)}`)
    assert.doesNotMatch(statement, /\bdrop\s+not\s+null\b/i, `${name} relaxes nothing: ${flat.slice(0, 80)}`)
    assert.doesNotMatch(statement, /\btruncate\b/i, `${name} truncates nothing`)
    assert.doesNotMatch(statement, /\bdelete\s+from\b/i, `${name} deletes no rows`)
    assert.doesNotMatch(statement, /\bupdate\s+public\./i, `${name} rewrites no rows: ${flat.slice(0, 80)}`)
    assert.doesNotMatch(statement, /\balter\s+column\s+\w+\s+type\b/i, `${name} changes no column type`)
    assert.doesNotMatch(statement, /\bconcurrently\b/i, `${name} is transaction-safe`)
    assert.doesNotMatch(statement, /\bsecurity\s+definer\b/i, `${name} adds no SECURITY DEFINER function`)
  }
}
assert.equal(seenApproved.size, APPROVED.length, 'every approved statement is present exactly as reviewed')
for (const statement of APPROVED) assert.ok(norm(script).includes(statement), `the runner allows: ${statement.slice(0, 60)}`)
// Files must be applied in numeric order.
const order = migrations.map((name) => script.indexOf(name))
assert.deepEqual([...order].sort((a, b) => a - b), order)

assert.match(script, /310356785722/)
assert.match(script, /"\$\{ADMIN_STEP_UP_MIGRATION_EXPECTED_SHA:-\}" =~ \^\[0-9a-f\]\{40\}\$/)
for (const name of readdirSync(new URL('./', import.meta.url)).filter((n) => n.endsWith('.sh'))) {
  const source = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
  for (const m of source.matchAll(/\[([^[\]]*)\]\{40\}/g)) assert.equal(m[1], '0-9a-f', `${name}: ${m[0]}`)
}
assert.match(script, /plan\|migrate-once/)
assert.match(script, /begin-transaction/)
assert.match(script, /commit-transaction/)
assert.match(script, /rollback-transaction/)
assert.match(script, /pg_advisory_xact_lock/)
assert.match(script, /sea_n_shore_applied_migrations/)
assert.match(script, /already_applied 0094_job_shares/, 'the admin step-up migration follows 0094_job_shares')
assert.match(script, /ADMIN_STEP_UP_SCHEMA_VERIFIED=true/)
assert.match(script, /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1/)

// A plan run previews in a transaction it always rolls back, and never commits or writes the ledger.
const plan = script.slice(script.indexOf('if [[ "$ACTION" == "plan" ]]; then'), script.indexOf('echo "ADMIN_STEP_UP_MIGRATION_PLAN_ONLY_NO_APPLY"'))
assert.ok(plan.length > 0, 'the plan preview is present')
assert.match(plan, /rollback_transaction "\$PREVIEW_TX"/)
assert.doesNotMatch(plan, /commit-transaction|sea_n_shore_applied_migrations/, 'the preview never commits')

// Evidence: each path prints its own last line, and the workflow requires only that line for the run's action.
const lastEcho = (text) => [...text.matchAll(/^\s*echo "(ADMIN_STEP_UP_MIGRATION_[A-Z_]+(?:=true)?)"$/gm)].at(-1)?.[1]
const nothingPending = script.slice(script.indexOf('if [[ "${#PENDING[@]}" -eq 0 ]]; then'), script.indexOf('if [[ "$ACTION" == "plan" ]]; then'))
assert.equal(lastEcho(nothingPending), 'ADMIN_STEP_UP_MIGRATION_ALREADY_APPLIED=true')
assert.equal(lastEcho(script.slice(0, script.indexOf('[[ "$(bash scripts/aws/branch-head.sh'))), 'ADMIN_STEP_UP_MIGRATION_PLAN_ONLY_NO_APPLY')
assert.equal(lastEcho(script), 'ADMIN_STEP_UP_MIGRATION_APPLY_VERIFIED=true')
const evidence = workflow.slice(workflow.indexOf('# evidence:begin'), workflow.indexOf('# evidence:end'))
  .split('\n').filter((line) => !line.trim().startsWith('#')).join('\n')
assert.match(evidence, /grep -q "\$EVIDENCE"/, 'the evidence check is present')
assert.doesNotMatch(evidence, /PLAN_VERIFIED/, 'the evidence check never requires the plan-only PLAN_VERIFIED line')
assert.match(evidence, /\^ADMIN_STEP_UP_MIGRATION_PLAN_ONLY_NO_APPLY\$/)
assert.match(evidence, /\^ADMIN_STEP_UP_MIGRATION_APPLY_VERIFIED=true\$/)
assert.match(evidence, /\^ADMIN_STEP_UP_MIGRATION_ALREADY_APPLIED=true\$/)

assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
assert.match(workflow, /Guard migration against a moved branch/)
assert.match(workflow, /environment:\s*staging/)
assert.match(workflow, /environment: staging-apply/)
assert.match(workflow, /bash scripts\/aws\/arm-commit-guard\.sh/)
assert.match(workflow, /ADMIN_STEP_UP_MIGRATION_EXPECTED_SHA/)
assert.match(workflow, /ADMIN_STEP_UP_MIGRATION_ACTION/)
assert.match(workflow, /I_APPROVE_ADMIN_STEP_UP_STAGING_MIGRATION/)
assert.match(workflow, /bash scripts\/aws\/admin-step-up-migration\.sh/)
assert.match(workflow, /trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM/)

console.log('ADMIN_STEP_UP_MIGRATION_CONTRACT_VERIFIED=true')
