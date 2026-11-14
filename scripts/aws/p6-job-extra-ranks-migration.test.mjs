import assert from 'node:assert/strict'
import fs, { readdirSync, readFileSync } from 'node:fs'
import { guardAction } from './guard-value.mjs'

const migrations = [
  '0103_p6_job_extra_ranks',
]
// Files that each hold exactly one CREATE INDEX CONCURRENTLY, run outside a transaction by the concurrent-index step.
const concurrentIndexes = [

]
const CONCURRENT_SHAPE = /^create index concurrently if not exists [a-z_][a-z0-9_]{0,62} on public\.[a-z_][a-z0-9_]* (using btree )?\([^;]+\)( where [^;]+)?;$/i
const script = fs.readFileSync('scripts/aws/p6-job-extra-ranks-migration.sh', 'utf8')
const guard = guardAction(fs.readFileSync('scripts/aws/p6-job-extra-ranks-migration-action.txt', 'utf8'))
const workflow = fs.readFileSync('.github/workflows/aws-p6-job-extra-ranks-migration.yml', 'utf8')

const norm = (text) => text.split(/\s+/).filter(Boolean).join(' ')
const statementsOf = (sql) => sql.split('-- statement-breakpoint')
  .map((part) => part.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
  .filter(Boolean)

// The only statements that may relax a rule or rewrite rows, word for word, each approved by the owner. The runner's
// ALLOWED list holds the same statements.
const APPROVED = [
]

assert.ok(['plan', 'migrate-once', 'convert-once', 'revert-once'].includes(guard))

// P6 conversion (owner-approved 13 Nov): exactly the 3 approved typed "Other" texts, each in both statements of the
// conversion, touching only jobs, audit_events and the extra-rank links; revert reads the recorded originals.
const APPROVED_CONVERSIONS = [
  ['chief engineer', ['chief_engineer']],
  ['master chief officer', ['master', 'chief_officer']],
  ['master mariner', ['master']],
]
const fixes = {
  convert: 'infra/aws/database/data-fixes/p6_other_rank_conversion.sql',
  revert: 'infra/aws/database/data-fixes/p6_other_rank_conversion_revert.sql',
}
for (const path of Object.values(fixes)) {
  assert.ok(script.includes(`"${path}"`), `the runner lists ${path}`)
  assert.ok(workflow.includes(`- ${path}`), `the workflow watches ${path}`)
  assert.ok(workflow.slice(workflow.indexOf('RUNNER_FILES:')).split('\n')[0].includes(path), `a change to ${path} runs a plan`)
  for (const statement of statementsOf(fs.readFileSync(path, 'utf8'))) {
    const tables = [...statement.matchAll(/\b(?:insert\s+into|update)\s+(public\.[a-z_]+)/gi)].map((m) => m[1])
    for (const table of tables) assert.ok(['public.jobs', 'public.audit_events', 'public.job_department_extra_ranks'].includes(table), `${path} writes only the P6 tables: ${table}`)
    assert.doesNotMatch(statement, /\b(delete\s+from|truncate|drop|alter|grant|revoke)\b/i, `${path} deletes, drops and alters nothing`)
  }
}
const convertSql = fs.readFileSync(fixes.convert, 'utf8')
const tuples = [...convertSql.matchAll(/\('([a-z ]+)', array\[([^\]]*)\]::text\[\]\)/g)].map((m) => [m[1], [...m[2].matchAll(/'([a-z_]+)'/g)].map((k) => k[1])])
assert.deepEqual(tuples, [...APPROVED_CONVERSIONS, ...APPROVED_CONVERSIONS], 'the conversion holds the 3 approved texts and nothing else, in both statements')
assert.match(convertSql, /role_other_text_original = j\.role_other_text/, 'the typed text is kept word for word')
assert.match(convertSql, /j\.role_other_text_original is null/, 'a job is converted at most once')
assert.match(convertSql, /'p6_other_rank_converted'/, 'each conversion is recorded for the revert')
assert.match(fs.readFileSync(fixes.revert, 'utf8'), /metadata -> 'original_keys'/, 'the revert restores the recorded ranks')
assert.match(script, /P6_CONVERSION_MAX_JOBS=3\n/, 'at most the 3 approved jobs may change')
const convertPath = script.slice(script.indexOf('if [[ "$ACTION" == "convert-once" || "$ACTION" == "revert-once" ]]; then'), script.indexOf('if [[ "${#PENDING[@]}" -eq 0 ]]; then'))
assert.ok(convertPath.length > 0, 'the conversion path is present')
assert.match(convertPath, /\[\[ "\$\{#PENDING\[@\]\}" -eq 0 \]\] \|\|/, 'the conversion needs 0103 applied')
assert.match(convertPath, /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1/, 'the conversion refuses a moved branch')
const fixStep = script.slice(script.indexOf('run_data_fix() {'), script.indexOf('if [[ "$ACTION" == "convert-once"'))
assert.match(fixStep, /pg_advisory_xact_lock/)
assert.ok(fixStep.indexOf('(( delta <= P6_CONVERSION_MAX_JOBS ))') < fixStep.indexOf('commit-transaction'), 'the job cap is checked before the commit')
assert.ok(fixStep.indexOf('if [[ "$mode" != commit ]]; then\n    rollback_transaction "$tx"') >= 0, 'a preview always rolls back')
// Dispatch stays plan / migrate-once: the conversion runs only from an owner-merged arm.
assert.match(workflow, /options:\n\s+- plan\n\s+- migrate-once\n\s+default: plan/)
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
assert.match(script, /"\$\{P6_JOB_EXTRA_RANKS_MIGRATION_EXPECTED_SHA:-\}" =~ \^\[0-9a-f\]\{40\}\$/)
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
assert.match(script, /already_applied 0101_app_role_timeouts/, 'job extra ranks follows 0101_app_role_timeouts')
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
const plan = script.slice(script.indexOf('if [[ "$ACTION" == "plan" ]]; then'), script.indexOf('echo "P6_JOB_EXTRA_RANKS_MIGRATION_PLAN_ONLY_NO_APPLY"'))
assert.ok(plan.length > 0, 'the plan preview is present')
assert.match(plan, /rollback_transaction "\$PREVIEW_TX"/)
assert.doesNotMatch(plan, /commit-transaction|sea_n_shore_applied_migrations/, 'the preview never commits')

// Evidence: each path prints its own last line, and the workflow requires only that line for the run's action.
const lastEcho = (text) => [...text.matchAll(/^\s*echo "(P6_JOB_EXTRA_RANKS_MIGRATION_[A-Z_]+(?:=true)?)"$/gm)].at(-1)?.[1]
const nothingPending = script.slice(script.indexOf('if [[ "${#PENDING[@]}" -eq 0 ]]; then'), script.indexOf('if [[ "$ACTION" == "plan" ]]; then'))
assert.equal(lastEcho(nothingPending), 'P6_JOB_EXTRA_RANKS_MIGRATION_ALREADY_APPLIED=true')
assert.equal(lastEcho(script.slice(0, script.indexOf('[[ "$(bash scripts/aws/branch-head.sh'))), 'P6_JOB_EXTRA_RANKS_MIGRATION_PLAN_ONLY_NO_APPLY')
assert.equal(lastEcho(script), 'P6_JOB_EXTRA_RANKS_MIGRATION_APPLY_VERIFIED=true')
const evidence = workflow.slice(workflow.indexOf('# evidence:begin'), workflow.indexOf('# evidence:end'))
  .split('\n').filter((line) => !line.trim().startsWith('#')).join('\n')
assert.match(evidence, /grep -q "\$EVIDENCE"/, 'the evidence check is present')
assert.doesNotMatch(evidence, /PLAN_VERIFIED/, 'the evidence check never requires the plan-only PLAN_VERIFIED line')
assert.match(evidence, /\^P6_JOB_EXTRA_RANKS_MIGRATION_PLAN_ONLY_NO_APPLY\$/)
assert.match(evidence, /\^P6_JOB_EXTRA_RANKS_MIGRATION_APPLY_VERIFIED=true\$/)
assert.match(evidence, /\^P6_JOB_EXTRA_RANKS_MIGRATION_ALREADY_APPLIED=true\$/)

assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
assert.match(workflow, /Guard migration against a moved branch/)
assert.match(workflow, /environment:\s*staging/)
assert.match(workflow, /environment: staging-apply/)
assert.match(workflow, /bash scripts\/aws\/arm-commit-guard\.sh/)
assert.match(workflow, /P6_JOB_EXTRA_RANKS_MIGRATION_EXPECTED_SHA/)
assert.match(workflow, /P6_JOB_EXTRA_RANKS_MIGRATION_ACTION/)
assert.match(workflow, /I_APPROVE_P6_JOB_EXTRA_RANKS_STAGING_MIGRATION/)
assert.match(workflow, /bash scripts\/aws\/p6-job-extra-ranks-migration\.sh/)
assert.match(workflow, /trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM/)

console.log('P6_JOB_EXTRA_RANKS_MIGRATION_CONTRACT_VERIFIED=true')
