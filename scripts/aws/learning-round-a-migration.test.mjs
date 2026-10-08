import assert from 'node:assert/strict'
import fs, { readdirSync, readFileSync } from 'node:fs'
import { guardAction } from './guard-value.mjs'

const migrations = [
  '0069_learning_round_a_notification_types',
  '0070_learning_round_a',
]
const script = fs.readFileSync('scripts/aws/learning-round-a-migration.sh', 'utf8')
const guard = guardAction(fs.readFileSync('scripts/aws/learning-round-a-migration-action.txt', 'utf8'))
const workflow = fs.readFileSync('.github/workflows/aws-learning-round-a-migration.yml', 'utf8')

assert.ok(['plan', 'migrate-once'].includes(guard))
for (const name of migrations) {
  const path = `infra/aws/database/migrations/${name}.sql`
  const sql = fs.readFileSync(path, 'utf8')
  assert.ok(script.includes(path), `script applies ${name}`)
  assert.ok(workflow.includes(path), `workflow watches ${name}`)
  assert.match(sql, /-- statement-breakpoint/, `${name} is split into statements`)
  const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(code, /\bdrop\s+(table|column|type|schema|index)\b/i, `${name} drops nothing`)
  assert.doesNotMatch(code, /\btruncate\b/i, `${name} truncates nothing`)
  assert.doesNotMatch(code, /\bdelete\s+from\b/i, `${name} deletes no rows`)
  assert.doesNotMatch(code, /\bupdate\s+public\./i, `${name} rewrites no existing rows`)
  assert.doesNotMatch(code, /\bconcurrently\b/i, `${name} is transaction-safe`)
  assert.doesNotMatch(code, /\bsecurity\s+definer\b/i, `${name} adds no SECURITY DEFINER function`)
}
// Files must be applied in numeric order.
const order = migrations.map((name) => script.indexOf(name))
assert.deepEqual([...order].sort((a, b) => a - b), order)

assert.match(script, /310356785722/)
assert.match(script, /LEARNING_ROUND_A_MIGRATION_EXPECTED_SHA/)
assert.match(script, /"\$\{LEARNING_ROUND_A_MIGRATION_EXPECTED_SHA:-\}" =~ \^\[0-9a-f\]\{40\}\$/)
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
assert.match(script, /LEARNING_ROUND_A_MIGRATION_PLAN_ONLY_NO_APPLY/)
assert.match(script, /LEARNING_ROUND_A_MIGRATION_APPLY_VERIFIED=true/)
assert.match(script, /LEARNING_ROUND_A_MIGRATION_ALREADY_APPLIED=true/)
assert.match(script, /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1/)

// The SIRE quiz report is read-only and reads course content, never learner rows.
const report = script.slice(script.indexOf('SIRE_QUIZ_REPORT course='), script.indexOf('SIRE_QUIZ_REPORT_DONE'))
assert.ok(report.length > 0, 'the SIRE quiz report is present')
assert.doesNotMatch(report, /\b(insert|update|delete|alter|create|drop)\b/i, 'the SIRE quiz report only reads')
assert.doesNotMatch(report, /public\.(learning_enrollments|learning_progress|profiles|learning_quiz_attempts|learning_assignment_attempts|learning_scorm_attempts)\b/i, 'the SIRE quiz report reads no learner data')
assert.ok(script.indexOf('SIRE_QUIZ_REPORT_DONE') < script.indexOf('LEARNING_ROUND_A_MIGRATION_PLAN_ONLY_NO_APPLY'), 'plan runs print the SIRE report')
// The report runs before 0069-0070 apply, so it must not touch a column they add, and it never stops the run.
const reportSetup = script.slice(script.indexOf('SIRE_COURSES='), script.indexOf('SIRE_QUIZ_REPORT_DONE'))
assert.doesNotMatch(reportSetup, /\b(revision_of_course_id|revision_closed_at|revision_outcome|revision_source_id|removed_at|article_format|caption_path|watched_seconds|furthest_position_seconds|max_files|trainer_digest_at)\b/, 'the SIRE report uses only columns that exist before this migration')
assert.equal((reportSetup.match(/\|\| echo "SIRE_REPORT_UNAVAILABLE/g) ?? []).length, 3, 'each SIRE report query is non-fatal')

assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
assert.match(workflow, /Guard migration against a moved branch/)
assert.match(workflow, /environment:\s*staging/)
assert.match(workflow, /environment: staging-apply/)
assert.match(workflow, /bash scripts\/aws\/arm-commit-guard\.sh/)
assert.match(workflow, /LEARNING_ROUND_A_MIGRATION_EXPECTED_SHA/)
assert.match(workflow, /I_APPROVE_LEARNING_ROUND_A_STAGING_MIGRATION/)
assert.match(workflow, /bash scripts\/aws\/learning-round-a-migration\.sh/)
assert.match(script, /LEARNING_ROUND_A_MIGRATION_ACTION/)
assert.match(workflow, /LEARNING_ROUND_A_MIGRATION_ACTION/)
assert.doesNotMatch(workflow, /round-9b|ROUND_9B/i)

const types = fs.readFileSync('infra/aws/database/migrations/0069_learning_round_a_notification_types.sql', 'utf8')
for (const type of [
  'learning_enrolled',
  'learning_lessons_released',
  'learning_assignment_graded',
  'learning_certificate_issued',
  'learning_course_approved',
  'learning_course_changes_requested',
  'learning_submissions_to_grade',
]) {
  assert.match(types, new RegExp(`alter type public\\.network_notification_type add value if not exists '${type}';`), `0069 adds ${type}`)
}
const roundA = fs.readFileSync('infra/aws/database/migrations/0070_learning_round_a.sql', 'utf8')
for (const fragment of [
  'add column if not exists revision_of_course_id uuid',
  'create unique index if not exists learning_courses_one_open_revision_idx',
  'add column if not exists removed_at timestamptz',
  'add column if not exists revision_source_id uuid',
  "add column if not exists article_format text not null default 'plain'",
  'add column if not exists caption_path text',
  'add column if not exists watched_seconds integer not null default 0',
  'alter column max_upload_bytes set default 20971520',
  'add column if not exists max_files integer not null default 5',
  'create table if not exists public.learning_assignment_attachments',
  'create table if not exists public.notification_email_preferences',
  'create table if not exists public.learning_notification_emails',
  'create unique index if not exists learning_notification_emails_dedupe_uq',
  'create table if not exists public.learning_release_notices',
]) {
  assert.ok(roundA.includes(fragment), `0070 contains ${fragment}`)
}

console.log('LEARNING_ROUND_A_MIGRATION_CONTRACT_VERIFIED=true')
