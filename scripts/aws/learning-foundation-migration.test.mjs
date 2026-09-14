import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflowPath = '.github/workflows/aws-learning-foundation-migration.yml'
const runnerPath = 'scripts/aws/learning-foundation-migration.sh'
const actionPath = 'scripts/aws/learning-foundation-migration-action.txt'
const contractPath = 'scripts/aws/learning-foundation-migration.test.mjs'

test('learning foundation migration is guarded, exact-head and one-shot', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const runner = readFileSync(runnerPath, 'utf8')
  const action = readFileSync(actionPath, 'utf8').trim()

  assert.ok(['plan', 'apply-once'].includes(action), `Unexpected learning foundation migration action: ${action}`)
  assert.equal(action, 'plan', 'Learning foundation migration guard must default to plan')
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- feat\/aws-native-phase-0-1/)
  assert.match(workflow, /scripts\/aws\/learning-foundation-migration-action\.txt/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Exact-head AWS Infrastructure CI is not green/)
  assert.match(workflow, /aws-actions\/configure-aws-credentials@v4/)
  assert.match(workflow, /LEARNING_FOUNDATION_MIGRATION_EXPECTED_SHA/)
  assert.match(workflow, /runuser -u ssm-user -- bash -lc/)
  assert.match(workflow, /bash scripts\/aws\/learning-foundation-migration\.sh/)

  assert.match(runner, /EXPECTED_ACCOUNT="310356785722"/)
  assert.doesNotMatch(runner, /992382634586/)
  assert.match(runner, /0016_learning_foundation\.sql/)
  assert.match(runner, /EXPECTED_STATEMENTS=17/)
  assert.match(runner, /EXPECTED_TABLES=7/)
  assert.match(runner, /EXPECTED_INDEXES=10/)
  assert.match(runner, /case "\$ACTION" in plan\|apply-once/)
  assert.match(runner, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)
  assert.match(runner, /begin-transaction/)
  assert.match(runner, /pg_advisory_xact_lock/)
  assert.match(runner, /rollback-transaction/)
  assert.match(runner, /commit-transaction/)
  assert.match(runner, /LEARNING_FOUNDATION_MIGRATION_PLAN_ONLY_NO_APPLY/)
  assert.match(runner, /LEARNING_FOUNDATION_MIGRATION_APPLY_VERIFIED=true/)
})

test('learning foundation migration verifies the exact seven-table additive shape', () => {
  const runner = readFileSync(runnerPath, 'utf8')

  for (const table of [
    'learning_mentor_applications',
    'learning_mentors',
    'learning_courses',
    'learning_course_sections',
    'learning_lessons',
    'learning_enrollments',
    'learning_progress',
  ]) assert.match(runner, new RegExp(table))

  for (const index of [
    'learning_mentor_applications_user_uq',
    'learning_mentor_applications_admin_queue_idx',
    'learning_courses_marketplace_idx',
    'learning_courses_mentor_idx',
    'learning_sections_course_position_uq',
    'learning_lessons_section_position_uq',
    'learning_enrollments_course_learner_uq',
    'learning_enrollments_learner_idx',
    'learning_progress_enrollment_lesson_uq',
    'learning_progress_enrollment_idx',
  ]) assert.match(runner, new RegExp(index))

  assert.match(runner, /Partial or unexpected learning foundation schema detected/)
  assert.match(runner, /LEARNING_FOUNDATION_MIGRATION_ALREADY_APPLIED=true/)
  assert.match(runner, /LEARNING_FOUNDATION_MIGRATION_PLAN_VERIFIED=FULL_ADDITIVE_APPLY/)
})

test('learning foundation migration contract permits apply-once during exact-head CI', () => {
  const contract = readFileSync(contractPath, 'utf8')

  assert.match(contract, /\['plan', 'apply-once'\]\.includes\(action\)/)
  assert.doesNotMatch(
    contract,
    /assert\.equal\(action,\s*['"]plan['"]/,
    'The exact-head migration contract must permit the temporary apply-once guard value.',
  )
})
