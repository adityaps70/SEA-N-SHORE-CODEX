import assert from 'node:assert/strict'
import fs from 'node:fs'
import { guardAction } from './guard-value.mjs'

const migrationPath = 'infra/aws/database/migrations/0071_learning_course_list_items.sql'
const script = fs.readFileSync('scripts/aws/learning-course-list-items.sh', 'utf8')
const guard = guardAction(fs.readFileSync('scripts/aws/learning-course-list-items-action.txt', 'utf8'))
const workflow = fs.readFileSync('.github/workflows/aws-learning-course-list-items.yml', 'utf8')
const sql = fs.readFileSync(migrationPath, 'utf8')

assert.ok(['plan', 'migrate-once'].includes(guard))
assert.ok(script.includes(migrationPath), 'the script applies 0071')
assert.ok(workflow.includes(migrationPath), 'the workflow watches 0071')

// 0071 only adds a backup table, fills it, and rewrites the three course list columns from it.
const statements = sql.split('-- statement-breakpoint').map((part) => part.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim()).filter(Boolean)
assert.equal(statements.length, 3, '0071 has three statements')
assert.match(statements[0], /^create table if not exists public\.learning_course_list_items_backup \(/)
assert.match(statements[1], /^insert into public\.learning_course_list_items_backup \(/)
assert.match(statements[1], /on conflict \(course_id\) do nothing;$/)
assert.match(statements[2], /^update public\.learning_courses course\s+set learning_outcomes = backup\.repaired_learning_outcomes,\s*requirements = backup\.repaired_requirements,\s*target_audience = backup\.repaired_target_audience\s+from public\.learning_course_list_items_backup backup/)
assert.match(statements[2], /and course\.learning_outcomes = backup\.learning_outcomes\s+and course\.requirements = backup\.requirements\s+and course\.target_audience = backup\.target_audience;$/, 'a course edited since its backup is never rewritten')
const code = statements.join('\n')
assert.doesNotMatch(code, /\bdrop\s+(table|column|type|schema|index|function)\b/i, '0071 drops nothing')
assert.doesNotMatch(code, /\btruncate\b/i, '0071 truncates nothing')
assert.doesNotMatch(code, /\bdelete\s+from\b/i, '0071 deletes no rows')
assert.doesNotMatch(code, /\balter\s+table\b/i, '0071 changes no existing table')
assert.doesNotMatch(code, /\bsecurity\s+definer\b/i, '0071 adds no SECURITY DEFINER function')
assert.equal((code.match(/\bupdate\s+public\./gi) ?? []).length, 1, '0071 rewrites one table')
assert.match(statements[1], /string_agg\(grouped\.item, ', ' order by grouped\.ord\)/, 'fragments are rejoined with the separator the old editor removed')

assert.match(script, /310356785722/)
assert.match(script, /"\$\{LEARNING_COURSE_LIST_ITEMS_EXPECTED_SHA:-\}" =~ \^\[0-9a-f\]\{40\}\$/)
assert.match(script, /plan\|migrate-once/)
assert.match(script, /begin-transaction/)
assert.match(script, /commit-transaction/)
assert.match(script, /rollback-transaction/)
assert.match(script, /pg_advisory_xact_lock/)
assert.match(script, /sea_n_shore_applied_migrations/)
assert.match(script, /applied 0070_learning_round_a/, '0071 follows the learning round A schema')
assert.match(script, /LEARNING_COURSE_LIST_ITEMS_PLAN_ONLY_NO_APPLY/)
assert.match(script, /LEARNING_COURSE_LIST_ITEMS_APPLY_VERIFIED=true/)
assert.match(script, /LEARNING_COURSE_LIST_ITEMS_ALREADY_APPLIED=true/)
assert.match(script, /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1/)

// A plan run previews the repair in a transaction it always rolls back, and never commits.
const plan = script.slice(script.indexOf('if [[ "$ACTION" == "plan" ]]; then'), script.indexOf('LEARNING_COURSE_LIST_ITEMS_PLAN_ONLY_NO_APPLY'))
assert.ok(plan.length > 0, 'the plan preview is present')
assert.match(plan, /rollback_transaction "\$PREVIEW_TX"/)
assert.doesNotMatch(plan, /commit-transaction|statement 2\b/, 'the preview never commits or rewrites a course')
// The lists report reads course content only, never learner rows.
const report = script.slice(script.indexOf('LEARNING_COURSE_LISTS_REPORT"'), script.indexOf('LEARNING_COURSE_LISTS_REPORT_DONE'))
assert.ok(report.length > 0, 'the lists report is present')
assert.doesNotMatch(report, /\b(insert|update|delete|alter|create|drop)\b/i, 'the lists report only reads')
assert.doesNotMatch(script, /public\.(learning_enrollments|learning_progress|profiles|learning_quiz_attempts|learning_assignment_attempts)\b/i, 'no learner data is read')

assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
assert.match(workflow, /Guard migration against a moved branch/)
assert.match(workflow, /environment:\s*staging/)
assert.match(workflow, /environment: staging-apply/)
assert.match(workflow, /bash scripts\/aws\/arm-commit-guard\.sh/)
assert.match(workflow, /LEARNING_COURSE_LIST_ITEMS_EXPECTED_SHA/)
assert.match(workflow, /LEARNING_COURSE_LIST_ITEMS_ACTION/)
assert.match(workflow, /I_APPROVE_LEARNING_COURSE_LIST_ITEMS_STAGING_REPAIR/)
assert.match(workflow, /bash scripts\/aws\/learning-course-list-items\.sh/)
assert.doesNotMatch(workflow, /round-a|ROUND_A|0069|0070/i)

console.log('LEARNING_COURSE_LIST_ITEMS_CONTRACT_VERIFIED=true')
