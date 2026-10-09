import assert from 'node:assert/strict'
import fs, { readdirSync, readFileSync } from 'node:fs'
import { guardAction } from './guard-value.mjs'

const migrations = [
  '0072_learning_round_b_notification_types',
  '0073_learning_round_b',
]
const script = fs.readFileSync('scripts/aws/learning-round-b-migration.sh', 'utf8')
const guard = guardAction(fs.readFileSync('scripts/aws/learning-round-b-migration-action.txt', 'utf8'))
const workflow = fs.readFileSync('.github/workflows/aws-learning-round-b-migration.yml', 'utf8')

const norm = (text) => text.split(/\s+/).filter(Boolean).join(' ')
const statementsOf = (sql) => sql.split('-- statement-breakpoint')
  .map((part) => part.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
  .filter(Boolean)

// The only statements that relax a rule or rewrite rows: the three approved relaxations, and the two backfill links.
const APPROVED = [
  'alter table public.learning_quiz_questions alter column quiz_id drop not null;',
  'drop index if exists public.learning_quiz_options_single_correct_uq;',
  'alter table public.learning_quiz_attempt_answers alter column selected_option_id drop not null, alter column correct_option_id drop not null;',
  'update public.learning_quiz_questions question set source_question_id = copy.id from public.learning_quiz_questions copy where copy.imported_from_question_id = question.id and question.source_question_id is null;',
  'update public.learning_quiz_questions question set source_question_id = live.source_question_id from public.learning_quiz_questions live where question.revision_source_id = live.id and question.source_question_id is null and live.source_question_id is not null;',
]
const KIND_CHECK = 'alter table public.learning_notification_emails drop constraint if exists learning_notification_emails_kind_check, add constraint learning_notification_emails_kind_check check ('
const ROUND_A_KINDS = ['enrolled', 'lessons_released', 'assignment_graded', 'certificate_issued', 'course_approved', 'course_changes_requested', 'submissions_to_grade']

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
    if (flat.startsWith(KIND_CHECK)) {
      for (const kind of ROUND_A_KINDS) assert.ok(flat.includes(`'${kind}'`), `the email kind check still allows ${kind}`)
      for (const kind of ['quiz_graded', 'certificate_expiring']) assert.ok(flat.includes(`'${kind}'`), `the email kind check allows ${kind}`)
      continue
    }
    assert.doesNotMatch(statement, /\bdrop\s+(table|column|type|schema|index|function|trigger|constraint)\b/i, `${name} drops nothing else: ${flat.slice(0, 80)}`)
    assert.doesNotMatch(statement, /\bdrop\s+not\s+null\b/i, `${name} relaxes nothing else: ${flat.slice(0, 80)}`)
    assert.doesNotMatch(statement, /\btruncate\b/i, `${name} truncates nothing`)
    assert.doesNotMatch(statement, /\bdelete\s+from\b/i, `${name} deletes no rows`)
    assert.doesNotMatch(statement, /\bupdate\s+public\./i, `${name} rewrites no other rows: ${flat.slice(0, 80)}`)
    assert.doesNotMatch(statement, /\balter\s+column\s+\w+\s+type\b/i, `${name} changes no column type`)
    assert.doesNotMatch(statement, /\bconcurrently\b/i, `${name} is transaction-safe`)
    assert.doesNotMatch(statement, /\bsecurity\s+definer\b/i, `${name} adds no SECURITY DEFINER function`)
  }
}
assert.equal(seenApproved.size, APPROVED.length, 'every approved relaxation and backfill link is present exactly as reviewed')
// The runner's allowlist is the same list.
for (const statement of APPROVED) assert.ok(norm(script).includes(statement), `the runner allows: ${statement.slice(0, 60)}`)
// Files must be applied in numeric order.
const order = migrations.map((name) => script.indexOf(name))
assert.deepEqual([...order].sort((a, b) => a - b), order)

assert.match(script, /310356785722/)
assert.match(script, /"\$\{LEARNING_ROUND_B_MIGRATION_EXPECTED_SHA:-\}" =~ \^\[0-9a-f\]\{40\}\$/)
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
assert.match(script, /already_applied 0070_learning_round_a/, 'round B follows the round A schema')
assert.match(script, /LEARNING_ROUND_B_MIGRATION_PLAN_ONLY_NO_APPLY/)
assert.match(script, /LEARNING_ROUND_B_MIGRATION_APPLY_VERIFIED=true/)
assert.match(script, /LEARNING_ROUND_B_MIGRATION_ALREADY_APPLIED=true/)
assert.match(script, /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1/)

// A plan run previews 0073 in a transaction it always rolls back, and never commits or writes the ledger.
const plan = script.slice(script.indexOf('if [[ "$ACTION" == "plan" ]]; then'), script.indexOf('LEARNING_ROUND_B_MIGRATION_PLAN_ONLY_NO_APPLY'))
assert.ok(plan.length > 0, 'the plan preview is present')
assert.match(plan, /rollback_transaction "\$PREVIEW_TX"/)
assert.doesNotMatch(plan, /commit-transaction|sea_n_shore_applied_migrations/, 'the preview never commits')
// Both "apply verified" and "plan verified" evidence lines are printed on their own path.
assert.ok(script.indexOf('LEARNING_ROUND_B_MIGRATION_PLAN_VERIFIED=true') < script.indexOf('LEARNING_ROUND_B_MIGRATION_PLAN_ONLY_NO_APPLY'))
// Reports read course content, never learner rows (the SQL allowlist itself names the tables it relaxes).
const queries = script.slice(script.indexOf('# Round B follows the round A schema.'))
assert.doesNotMatch(queries, /public\.(learning_enrollments|learning_progress|profiles|learning_quiz_attempts|learning_quiz_attempt_answers|learning_quiz_attempt_sessions|learning_assignment_attempts|learning_certificates)\b/i, 'no learner data is read')

assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
assert.match(workflow, /Guard migration against a moved branch/)
assert.match(workflow, /environment:\s*staging/)
assert.match(workflow, /environment: staging-apply/)
assert.match(workflow, /bash scripts\/aws\/arm-commit-guard\.sh/)
assert.match(workflow, /LEARNING_ROUND_B_MIGRATION_EXPECTED_SHA/)
assert.match(workflow, /LEARNING_ROUND_B_MIGRATION_ACTION/)
assert.match(workflow, /I_APPROVE_LEARNING_ROUND_B_STAGING_MIGRATION/)
assert.match(workflow, /bash scripts\/aws\/learning-round-b-migration\.sh/)
assert.match(workflow, /trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM/)
assert.doesNotMatch(workflow, /round-a|ROUND_A|0069|0070/i)
// The evidence check accepts the line each path prints.
assert.match(workflow, /LEARNING_ROUND_B_MIGRATION_APPLY_VERIFIED=true/)

const types = fs.readFileSync('infra/aws/database/migrations/0072_learning_round_b_notification_types.sql', 'utf8')
for (const type of ['learning_quiz_graded', 'learning_certificate_expiring']) {
  assert.match(types, new RegExp(`alter type public\\.network_notification_type add value if not exists '${type}';`), `0072 adds ${type}`)
}
const roundB = norm(fs.readFileSync('infra/aws/database/migrations/0073_learning_round_b.sql', 'utf8'))
for (const fragment of [
  'create table if not exists public.learning_question_banks',
  'add column if not exists question_type text not null default \'single_choice\'',
  'add column if not exists answer_policy text not null default \'after_each_attempt\'',
  'create table if not exists public.learning_quiz_attempt_sessions',
  'create unique index if not exists learning_quiz_attempt_sessions_open_uq',
  'add column if not exists status text not null default \'completed\'',
  'add column if not exists grading_status text not null default \'auto\'',
  'create constraint trigger learning_quiz_options_single_correct_check',
  'add column if not exists certificate_template text not null default \'classic\'',
  'add column if not exists hidden_from_profile boolean not null default false',
  'add column if not exists certificate_final boolean not null default false',
]) {
  assert.ok(roundB.includes(fragment), `0073 contains ${fragment}`)
}
// The single-correct index is only dropped after its replacement check exists.
assert.ok(roundB.indexOf('create constraint trigger learning_quiz_options_single_correct_check') < roundB.indexOf('drop index if exists public.learning_quiz_options_single_correct_uq'))

console.log('LEARNING_ROUND_B_MIGRATION_CONTRACT_VERIFIED=true')
