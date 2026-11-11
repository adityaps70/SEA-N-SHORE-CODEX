import assert from 'node:assert/strict'
import fs, { readdirSync, readFileSync } from 'node:fs'
import { guardAction } from './guard-value.mjs'

const migrations = [
  '0101_app_role_timeouts',
]
// Files that each hold exactly one CREATE INDEX CONCURRENTLY, run outside a transaction by the concurrent-index step.
const concurrentIndexes = [

]
const CONCURRENT_SHAPE = /^create index concurrently if not exists [a-z_][a-z0-9_]{0,62} on public\.[a-z_][a-z0-9_]* (using btree )?\([^;]+\)( where [^;]+)?;$/i
const script = fs.readFileSync('scripts/aws/app-role-timeouts-migration.sh', 'utf8')
const guard = guardAction(fs.readFileSync('scripts/aws/app-role-timeouts-migration-action.txt', 'utf8'))
const workflow = fs.readFileSync('.github/workflows/aws-app-role-timeouts-migration.yml', 'utf8')

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
  if (concurrentIndexes.includes(name)) {
    const statements = statementsOf(sql)
    assert.equal(statements.length, 1, `${name} holds exactly one statement`)
    assert.match(norm(statements[0]), CONCURRENT_SHAPE, `${name} is one CREATE INDEX CONCURRENTLY IF NOT EXISTS on public`)
    assert.doesNotMatch(statements[0], /\b(drop|truncate|delete|update|alter|grant|revoke|unique)\b/i, `${name} only builds an index`)
    assert.ok(script.slice(script.indexOf('CONCURRENT_INDEX_MIGRATIONS=('), script.indexOf('is_concurrent_index()')).includes(`"${path}"`), `${name} runs in the concurrent-index step`)
    continue
  }
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
assert.match(script, /"\$\{APP_ROLE_TIMEOUTS_MIGRATION_EXPECTED_SHA:-\}" =~ \^\[0-9a-f\]\{40\}\$/)
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
assert.match(script, /already_applied 0100_round_db_claims_email_index/, 'app role timeouts follows 0100_round_db_claims_email_index')
assert.match(script, /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1/)

// The concurrent-index step: outside a transaction, the catalog is the evidence, an INVALID index is dropped (only
// ever that index, by name) and fails the run, and the ledger row is written only for a valid, ready index.
const concurrentStep = script.slice(script.indexOf('apply_concurrent_index_file() {'), script.indexOf('for migration in "${PENDING[@]}"; do\n  if is_concurrent_index'))
assert.ok(concurrentStep.length > 0, 'the concurrent-index step is present')
assert.doesNotMatch(concurrentStep, /--transaction-id|begin_transaction/, 'the concurrent index runs outside a transaction')
assert.match(concurrentStep, /data_api --continue-after-timeout --sql "\$sql"/)
assert.match(concurrentStep, /pg_stat_progress_create_index WHERE relid = to_regclass\('public\.\$table'\)/)
assert.match(script, /WHEN i\.indisvalid AND i\.indisready THEN 'valid' ELSE 'invalid' END FROM pg_index i WHERE i\.indexrelid = to_regclass\('public\.\$1'\)/)
assert.deepEqual([...script.matchAll(/DROP INDEX[^"]*/g)].map((m) => m[0]), ['DROP INDEX CONCURRENTLY IF EXISTS public.$index', 'DROP INDEX CONCURRENTLY IF EXISTS public.$index'], 'only the step drops, and only its own index')
assert.ok(concurrentStep.indexOf('valid) ;;') < concurrentStep.indexOf('INSERT INTO public.sea_n_shore_applied_migrations'), 'the ledger row follows a valid index')
assert.match(concurrentStep, /invalid\)\n\s+data_api --sql "DROP INDEX CONCURRENTLY IF EXISTS public\.\$index" >\/dev\/null\n[^\n]*\n[^\n]*\n\s+exit 1 ;;/)

// A plan run previews in a transaction it always rolls back, and never commits or writes the ledger.
const plan = script.slice(script.indexOf('if [[ "$ACTION" == "plan" ]]; then'), script.indexOf('echo "APP_ROLE_TIMEOUTS_MIGRATION_PLAN_ONLY_NO_APPLY"'))
assert.ok(plan.length > 0, 'the plan preview is present')
assert.match(plan, /rollback_transaction "\$PREVIEW_TX"/)
assert.doesNotMatch(plan, /commit-transaction|sea_n_shore_applied_migrations/, 'the preview never commits')

// Evidence: each path prints its own last line, and the workflow requires only that line for the run's action.
const lastEcho = (text) => [...text.matchAll(/^\s*echo "(APP_ROLE_TIMEOUTS_MIGRATION_[A-Z_]+(?:=true)?)"$/gm)].at(-1)?.[1]
const nothingPending = script.slice(script.indexOf('if [[ "${#PENDING[@]}" -eq 0 ]]; then'), script.indexOf('if [[ "$ACTION" == "plan" ]]; then'))
assert.equal(lastEcho(nothingPending), 'APP_ROLE_TIMEOUTS_MIGRATION_ALREADY_APPLIED=true')
assert.equal(lastEcho(script.slice(0, script.indexOf('[[ "$(bash scripts/aws/branch-head.sh'))), 'APP_ROLE_TIMEOUTS_MIGRATION_PLAN_ONLY_NO_APPLY')
assert.equal(lastEcho(script), 'APP_ROLE_TIMEOUTS_MIGRATION_APPLY_VERIFIED=true')
const evidence = workflow.slice(workflow.indexOf('# evidence:begin'), workflow.indexOf('# evidence:end'))
  .split('\n').filter((line) => !line.trim().startsWith('#')).join('\n')
assert.match(evidence, /grep -q "\$EVIDENCE"/, 'the evidence check is present')
assert.doesNotMatch(evidence, /PLAN_VERIFIED/, 'the evidence check never requires the plan-only PLAN_VERIFIED line')
assert.match(evidence, /\^APP_ROLE_TIMEOUTS_MIGRATION_PLAN_ONLY_NO_APPLY\$/)
assert.match(evidence, /\^APP_ROLE_TIMEOUTS_MIGRATION_APPLY_VERIFIED=true\$/)
assert.match(evidence, /\^APP_ROLE_TIMEOUTS_MIGRATION_ALREADY_APPLIED=true\$/)

assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
assert.match(workflow, /Guard migration against a moved branch/)
assert.match(workflow, /environment:\s*staging/)
assert.match(workflow, /environment: staging-apply/)
assert.match(workflow, /bash scripts\/aws\/arm-commit-guard\.sh/)
assert.match(workflow, /APP_ROLE_TIMEOUTS_MIGRATION_EXPECTED_SHA/)
assert.match(workflow, /APP_ROLE_TIMEOUTS_MIGRATION_ACTION/)
assert.match(workflow, /I_APPROVE_APP_ROLE_TIMEOUTS_STAGING_MIGRATION/)
assert.match(workflow, /bash scripts\/aws\/app-role-timeouts-migration\.sh/)
assert.match(workflow, /trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM/)

// Round DB: exactly the two limits on the app role, and the evidence (read-only, rolled back, counts, times and
// normalised statement shapes only) in the plan and again after apply.
assert.deepEqual(statementsOf(fs.readFileSync('infra/aws/database/migrations/0101_app_role_timeouts.sql', 'utf8')).map(norm), [
  "alter role sea_n_shore_app set statement_timeout = '10s';",
  "alter role sea_n_shore_app set idle_in_transaction_session_timeout = '60s';",
])
const roleEvidence = script.slice(script.indexOf('read_only_json() {'), script.indexOf('# app role timeouts follows'))
assert.match(roleEvidence, /data_api --transaction-id "\$tx" --sql "SET TRANSACTION READ ONLY"/)
assert.match(roleEvidence, /rollback_transaction "\$tx"/)
assert.doesNotMatch(roleEvidence, /commit-transaction|INSERT|UPDATE public|DELETE/)
for (const sql of roleEvidence.match(/read_only_json "[^\n]*"\)/g) ?? []) assert.match(sql, /read_only_json "SELECT /, sql)
assert.doesNotMatch(roleEvidence, /email AS|full_name|\.email\b(?! = )/, 'no member column is selected')
assert.match(roleEvidence, /left\(regexp_replace\(query, '\\s\+', ' ', 'g'\), 140\) AS shape FROM pg_stat_statements/)
assert.equal((script.match(/^\s*app_role_evidence$/gm) ?? []).length, 2, 'in the plan and after apply')
assert.ok(script.indexOf('app_role_evidence\n') < script.indexOf('PLAN_ONLY_NO_APPLY"'), 'the plan shows the evidence')
assert.match(script, /idle_in_transaction_session_timeout=60s,"\* \]\] \|\| \{ echo "The app role does not carry both limits/)

console.log('APP_ROLE_TIMEOUTS_MIGRATION_CONTRACT_VERIFIED=true')
