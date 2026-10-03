import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflowPath = '.github/workflows/aws-learning-launch-migration.yml'
const runnerPath = 'scripts/aws/learning-launch-migration.sh'
const actionPath = 'scripts/aws/learning-launch-migration-action.txt'

test('learning launch migration is exact-head, additive and one-shot guarded', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const runner = readFileSync(runnerPath, 'utf8')
  const action = readFileSync(actionPath, 'utf8').trim()

  assert.ok(['plan', 'apply-once'].includes(action), `Unexpected learning launch migration action: ${action}`)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /scripts\/aws\/learning-launch-migration-action\.txt/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Exact-head AWS Infrastructure CI is not green/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /aws-actions\/configure-aws-credentials@v4/)
  assert.match(workflow, /LEARNING_LAUNCH_MIGRATION_EXPECTED_SHA/)
  assert.match(workflow, /runuser -u ssm-user -- bash -lc/)
  assert.match(workflow, /bash scripts\/aws\/learning-launch-migration\.sh/)

  assert.match(runner, /EXPECTED_ACCOUNT="310356785722"/)
  assert.doesNotMatch(runner, /992382634586/)
  assert.match(runner, /0017_learning_quiz_assessments\.sql/)
  assert.match(runner, /0018_learning_certificates\.sql/)
  assert.match(runner, /EXPECTED_QUIZ_STATEMENTS=11/)
  assert.match(runner, /EXPECTED_CERTIFICATE_STATEMENTS=3/)
  assert.match(runner, /case "\$ACTION" in plan\|apply-once/)
  assert.match(runner, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)
  assert.match(runner, /begin-transaction/)
  assert.match(runner, /pg_advisory_xact_lock/)
  assert.match(runner, /rollback-transaction/)
  assert.match(runner, /commit-transaction/)
  assert.match(runner, /LEARNING_LAUNCH_MIGRATION_PLAN_ONLY_NO_APPLY/)
  assert.match(runner, /LEARNING_LAUNCH_MIGRATION_APPLY_VERIFIED=true/)
})

test('learning launch migration accepts only safe complete schema states', () => {
  const runner = readFileSync(runnerPath, 'utf8')
  for (const table of [
    'learning_quizzes',
    'learning_quiz_questions',
    'learning_quiz_options',
    'learning_quiz_attempts',
    'learning_quiz_attempt_answers',
    'learning_certificates',
  ]) assert.match(runner, new RegExp(table))

  for (const index of [
    'learning_quiz_questions_quiz_position_uq',
    'learning_quiz_options_question_position_uq',
    'learning_quiz_options_single_correct_uq',
    'learning_quiz_attempts_enrollment_idx',
    'learning_quiz_attempts_learner_idx',
    'learning_quiz_attempt_answers_attempt_question_uq',
    'learning_certificates_learner_idx',
    'learning_certificates_verification_idx',
  ]) assert.match(runner, new RegExp(index))

  assert.match(runner, /5\/6\/1\/2/)
  assert.match(runner, /0\/0\/0\/0/)
  assert.match(runner, /5\/6\/0\/0/)
  assert.match(runner, /Partial or unexpected learning launch schema detected/)
})
