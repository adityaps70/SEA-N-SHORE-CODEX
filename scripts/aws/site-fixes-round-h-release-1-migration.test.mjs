import assert from 'node:assert/strict'
import fs, { readdirSync, readFileSync } from 'node:fs'
import { guardAction } from './guard-value.mjs'

const migrations = [
  '0087_site_fixes_round_h_release_1',
]
const script = fs.readFileSync('scripts/aws/site-fixes-round-h-release-1-migration.sh', 'utf8')
const guard = guardAction(fs.readFileSync('scripts/aws/site-fixes-round-h-release-1-migration-action.txt', 'utf8'))
const workflow = fs.readFileSync('.github/workflows/aws-site-fixes-round-h-release-1-migration.yml', 'utf8')

const norm = (text) => text.split(/\s+/).filter(Boolean).join(' ')
const statementsOf = (sql) => sql.split('-- statement-breakpoint')
  .map((part) => part.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
  .filter(Boolean)

// The only statements that may relax a rule or rewrite rows, word for word, each approved by the owner. The runner's
// ALLOWED list holds the same statements.
const APPROVED = [
  // Round H release 1, approved by the owner in the round H brief (H2 self-issued certificates, H9 clean-up).
  `update public.learning_certificates certificate set issuer_relation = 'self_issued' from public.learning_courses course where course.id = certificate.course_id and certificate.issuer_relation = 'independent' and (exists (select 1 from public.learning_mentors own_mentor where own_mentor.id = course.mentor_id and own_mentor.user_id = certificate.learner_id) or exists (select 1 from public.company_members own_team where own_team.company_id = course.company_id and own_team.user_id = certificate.learner_id and own_team.approved_at is not null));`,
  `update public.learning_certificates certificate set hidden_from_profile = true from public.learning_courses course where course.id = certificate.course_id and lower(course.title) = 'iktyujdhrgsefawd' and certificate.hidden_from_profile = false;`,
  `update public.learning_courses set status = 'archived', removed_at = now(), updated_at = now() where removed_at is null and (lower(title) = 'iktyujdhrgsefawd' or revision_of_course_id in (select live.id from public.learning_courses live where lower(live.title) = 'iktyujdhrgsefawd'));`,
  `update public.events set removed_at = now(), updated_at = now() where lower(title) like 'sea n shore portal%brainstorming%market%' and status = 'cancelled' and removed_at is null;`,
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
assert.match(script, /"\$\{SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_EXPECTED_SHA:-\}" =~ \^\[0-9a-f\]\{40\}\$/)
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
assert.match(script, /already_applied 0086_sire_course_transfer/, 'site fixes round H release 1 follows 0086_sire_course_transfer')
assert.match(script, /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1/)

// A plan run previews in a transaction it always rolls back, and never commits or writes the ledger.
const plan = script.slice(script.indexOf('if [[ "$ACTION" == "plan" ]]; then'), script.indexOf('echo "SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_PLAN_ONLY_NO_APPLY"'))
assert.ok(plan.length > 0, 'the plan preview is present')
assert.match(plan, /rollback_transaction "\$PREVIEW_TX"/)
assert.doesNotMatch(plan, /commit-transaction|sea_n_shore_applied_migrations/, 'the preview never commits')

// Evidence: each path prints its own last line, and the workflow requires only that line for the run's action.
const lastEcho = (text) => [...text.matchAll(/^\s*echo "(SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_[A-Z_]+(?:=true)?)"$/gm)].at(-1)?.[1]
const nothingPending = script.slice(script.indexOf('if [[ "${#PENDING[@]}" -eq 0 ]]; then'), script.indexOf('if [[ "$ACTION" == "plan" ]]; then'))
assert.equal(lastEcho(nothingPending), 'SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_ALREADY_APPLIED=true')
assert.equal(lastEcho(script.slice(0, script.indexOf('[[ "$(bash scripts/aws/branch-head.sh'))), 'SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_PLAN_ONLY_NO_APPLY')
assert.equal(lastEcho(script), 'SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_APPLY_VERIFIED=true')
const evidence = workflow.slice(workflow.indexOf('# evidence:begin'), workflow.indexOf('# evidence:end'))
  .split('\n').filter((line) => !line.trim().startsWith('#')).join('\n')
assert.match(evidence, /grep -q "\$EVIDENCE"/, 'the evidence check is present')
assert.doesNotMatch(evidence, /PLAN_VERIFIED/, 'the evidence check never requires the plan-only PLAN_VERIFIED line')
assert.match(evidence, /\^SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_PLAN_ONLY_NO_APPLY\$/)
assert.match(evidence, /\^SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_APPLY_VERIFIED=true\$/)
assert.match(evidence, /\^SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_ALREADY_APPLIED=true\$/)

assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
assert.match(workflow, /Guard migration against a moved branch/)
assert.match(workflow, /environment:\s*staging/)
assert.match(workflow, /environment: staging-apply/)
assert.match(workflow, /bash scripts\/aws\/arm-commit-guard\.sh/)
assert.match(workflow, /SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_EXPECTED_SHA/)
assert.match(workflow, /SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_ACTION/)
assert.match(workflow, /I_APPROVE_SITE_FIXES_ROUND_H_RELEASE_1_STAGING_MIGRATION/)
assert.match(workflow, /bash scripts\/aws\/site-fixes-round-h-release-1-migration\.sh/)
assert.match(workflow, /trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM/)

console.log('SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_CONTRACT_VERIFIED=true')

// Round H release 1: the dry run prints ids, statuses and counts only, lists other likely test records for the
// owner to confirm, and the apply path checks the result before APPLY_VERIFIED.
assert.match(script, /^h_dry_run$/m)
for (const line of ['H_SELF_ISSUED_CERTIFICATES', 'H_TEST_COURSES', 'H_TEST_COURSE_CERTIFICATES', 'H_INTERNAL_EVENTS', 'H_CANDIDATE_TEST_COURSES', 'H_CANDIDATE_TEST_EVENTS', 'H_CANDIDATE_TEST_JOBS', 'H_CANDIDATE_TEST_COMMUNITIES', 'H_CANDIDATE_TEST_ORGANIZATIONS']) {
  assert.ok(script.includes(`echo "${line} `), line)
}
const dryRun = script.slice(script.indexOf('h_dry_run() {'), script.indexOf('\n}\n', script.indexOf('h_dry_run() {')))
for (const [, columns] of dryRun.matchAll(/SELECT\s+(.*?)\s+FROM/gs)) {
  assert.doesNotMatch(columns, /\b(title|name|full_name|email)\b/i, `the dry run never prints titles, names or emails: ${columns}`)
}
const afterApply = script.slice(script.indexOf('# Round H release 1 checks after apply.'))
assert.ok(afterApply.indexOf('H_RELEASE_1_DATA_VERIFIED=true') < afterApply.indexOf('SITE_FIXES_ROUND_H_RELEASE_1_MIGRATION_APPLY_VERIFIED=true'))
assert.match(afterApply, /still marked independent/)
assert.match(afterApply, /test course is still listed/)
assert.match(afterApply, /internal event is still listed/)
