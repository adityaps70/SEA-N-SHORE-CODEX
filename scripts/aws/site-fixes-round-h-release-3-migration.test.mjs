import assert from 'node:assert/strict'
import fs, { readdirSync, readFileSync } from 'node:fs'
import { guardAction } from './guard-value.mjs'

const migrations = [
  '0089_site_fixes_round_h_release_3',
]
const script = fs.readFileSync('scripts/aws/site-fixes-round-h-release-3-migration.sh', 'utf8')
const guard = guardAction(fs.readFileSync('scripts/aws/site-fixes-round-h-release-3-migration-action.txt', 'utf8'))
const workflow = fs.readFileSync('.github/workflows/aws-site-fixes-round-h-release-3-migration.yml', 'utf8')

const norm = (text) => text.split(/\s+/).filter(Boolean).join(' ')
const statementsOf = (sql) => sql.split('-- statement-breakpoint')
  .map((part) => part.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
  .filter(Boolean)

// The only statements that may relax a rule or rewrite rows, word for word, each approved by the owner. The runner's
// ALLOWED list holds the same statements.
const APPROVED = [
  // Round H release 3 (H7), approved by the owner in the round H brief: urgent jobs get urgent_since.
  `update public.jobs set urgent_since = coalesce(published_at, created_at) where urgent and urgent_since is null;`,
].map(norm)

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
assert.match(script, /"\$\{SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_EXPECTED_SHA:-\}" =~ \^\[0-9a-f\]\{40\}\$/)
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
assert.match(script, /already_applied 0088_site_fixes_round_h_release_2_seo/, 'site fixes round H release 3 follows 0088_site_fixes_round_h_release_2_seo')
assert.match(script, /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1/)

// A plan run previews in a transaction it always rolls back, and never commits or writes the ledger.
const plan = script.slice(script.indexOf('if [[ "$ACTION" == "plan" ]]; then'), script.indexOf('echo "SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_PLAN_ONLY_NO_APPLY"'))
assert.ok(plan.length > 0, 'the plan preview is present')
assert.match(plan, /rollback_transaction "\$PREVIEW_TX"/)
assert.doesNotMatch(plan, /commit-transaction|sea_n_shore_applied_migrations/, 'the preview never commits')

// Evidence: each path prints its own last line, and the workflow requires only that line for the run's action.
const lastEcho = (text) => [...text.matchAll(/^\s*echo "(SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_[A-Z_]+(?:=true)?)"$/gm)].at(-1)?.[1]
const nothingPending = script.slice(script.indexOf('if [[ "${#PENDING[@]}" -eq 0 ]]; then'), script.indexOf('if [[ "$ACTION" == "plan" ]]; then'))
assert.equal(lastEcho(nothingPending), 'SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_ALREADY_APPLIED=true')
assert.equal(lastEcho(script.slice(0, script.indexOf('[[ "$(bash scripts/aws/branch-head.sh'))), 'SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_PLAN_ONLY_NO_APPLY')
assert.equal(lastEcho(script), 'SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_APPLY_VERIFIED=true')
const evidence = workflow.slice(workflow.indexOf('# evidence:begin'), workflow.indexOf('# evidence:end'))
  .split('\n').filter((line) => !line.trim().startsWith('#')).join('\n')
assert.match(evidence, /grep -q "\$EVIDENCE"/, 'the evidence check is present')
assert.doesNotMatch(evidence, /PLAN_VERIFIED/, 'the evidence check never requires the plan-only PLAN_VERIFIED line')
assert.match(evidence, /\^SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_PLAN_ONLY_NO_APPLY\$/)
assert.match(evidence, /\^SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_APPLY_VERIFIED=true\$/)
assert.match(evidence, /\^SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_ALREADY_APPLIED=true\$/)

assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
assert.match(workflow, /Guard migration against a moved branch/)
assert.match(workflow, /environment:\s*staging/)
assert.match(workflow, /environment: staging-apply/)
assert.match(workflow, /bash scripts\/aws\/arm-commit-guard\.sh/)
assert.match(workflow, /SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_EXPECTED_SHA/)
assert.match(workflow, /SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_ACTION/)
assert.match(workflow, /I_APPROVE_SITE_FIXES_ROUND_H_RELEASE_3_STAGING_MIGRATION/)
assert.match(workflow, /bash scripts\/aws\/site-fixes-round-h-release-3-migration\.sh/)
assert.match(workflow, /trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM/)

console.log('SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_CONTRACT_VERIFIED=true')

// Round H release 3: the apply path checks the new tables, jobs.urgent_since, its backfill and the urgent index before
// APPLY_VERIFIED, and reads no ticket rows.
const afterApply = script.slice(script.indexOf('# Round H release 3 checks after apply'))
assert.ok(afterApply.indexOf('H_RELEASE_3_SCHEMA_VERIFIED=true') < afterApply.indexOf('SITE_FIXES_ROUND_H_RELEASE_3_MIGRATION_APPLY_VERIFIED=true'))
for (const table of ['site_settings', 'support_tickets', 'support_ticket_messages', 'support_ticket_emails']) assert.ok(afterApply.includes(table), table)
assert.match(afterApply, /urgent_since IS NULL/)
assert.match(afterApply, /jobs_company_urgent_idx/)
assert.doesNotMatch(afterApply, /FROM public\.support_ticket/i, 'the checks never read ticket rows')

// Round H release 3: the apply path also checks the owner reply columns and checks on learning_course_reviews, and
// that every rank key the taxonomy added in round H is in public.maritime_ranks (and seeded by 0089), reading no
// review rows.
const releaseSql = fs.readFileSync('infra/aws/database/migrations/0089_site_fixes_round_h_release_3.sql', 'utf8')
for (const column of ['owner_reply', 'owner_replied_at', 'owner_replied_by', 'owner_reply_status']) {
  assert.match(releaseSql, new RegExp(`add column if not exists ${column} `), `0089 adds ${column}`)
  assert.ok(afterApply.includes(column), `the runner checks ${column}`)
}
for (const constraint of ['learning_course_reviews_owner_reply_check', 'learning_course_reviews_owner_reply_status_check', 'learning_course_reviews_owner_replied_at_check']) {
  assert.ok(afterApply.includes(constraint), `the runner checks ${constraint}`)
}
const taxonomy = fs.readFileSync('src/features/roles/taxonomy.ts', 'utf8')
const addedBlock = taxonomy.slice(taxonomy.indexOf('export const ROLE_KEYS_ADDED_IN_ROUND_H'), taxonomy.indexOf('] as const', taxonomy.indexOf('export const ROLE_KEYS_ADDED_IN_ROUND_H')))
const addedRanks = [...addedBlock.matchAll(/'([a-z][a-z0-9_]*)'/g)].map((match) => match[1])
assert.ok(addedRanks.length >= 2, 'the taxonomy lists the round H ranks')
for (const code of ['operations_coordinator', 'ship_chandler']) assert.ok(addedRanks.includes(code), `the taxonomy adds ${code}`)
const rankSeed = releaseSql.slice(releaseSql.indexOf('insert into public.maritime_ranks'))
assert.match(rankSeed, /on conflict \(code\) do nothing;/, 'the rank seed is idempotent')
for (const code of addedRanks) {
  assert.ok(rankSeed.includes(`('${code}',`), `0089 seeds ${code}`)
  assert.ok(afterApply.includes(`'${code}'`), `the runner checks ${code}`)
}
assert.match(afterApply, new RegExp(`== "${addedRanks.length}" \\]\\]`), 'the runner expects every round H rank')
assert.doesNotMatch(afterApply, /FROM public\.learning_course_reviews/i, 'the checks never read review rows')
