import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const actionPath = 'scripts/aws/learning-assignment-review-e2e-action.txt'
const workflowPath = '.github/workflows/aws-learning-assignment-review-e2e.yml'
const browserScriptPath = 'scripts/aws/learning-assignment-review-staging-e2e.mjs'
const ssmHelperPath = 'scripts/aws/learning-assignment-review-e2e-ssm.mjs'
const remoteScriptPath = 'scripts/aws/learning-assignment-review-e2e-remote.sh'

test('learning assignment review e2e is feature-branch scoped with a plan or exact run-once guard', () => {
  assert.equal(existsSync(actionPath), true, `${actionPath} must exist`)
  const action = readFileSync(actionPath, 'utf8').trim()
  assert.ok(['plan', 'run-once'].includes(action), `Unexpected learning assignment review E2E action: ${action}`)
  assert.equal(existsSync(workflowPath), true, `${workflowPath} must exist`)

  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /feat\/aws-native-phase-0-1/)
  assert.match(workflow, /scripts\/aws\/learning-assignment-review-e2e-action\.txt/)
  assert.match(workflow, /LEARNING_ASSIGNMENT_REVIEW_E2E_ACTION/)
  assert.match(workflow, /run-once/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /actions:\s*read/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Exact-head AWS Infrastructure CI is not green/)
  assert.match(workflow, /Guard push E2E against a moved branch/)
  assert.match(workflow, /310356785722/)
  assert.doesNotMatch(workflow, /992382634586/)
})

test('run-once uses disposable authenticated users and the live learner and mentor assignment UI', () => {
  for (const path of [browserScriptPath, ssmHelperPath, remoteScriptPath]) {
    assert.equal(existsSync(path), true, `${path} must exist`)
  }
  const workflow = readFileSync(workflowPath, 'utf8')
  const browserScript = readFileSync(browserScriptPath, 'utf8')
  const ssmHelper = readFileSync(ssmHelperPath, 'utf8')

  assert.match(workflow, /npx playwright install --with-deps chromium/)
  assert.match(workflow, /sea-n-shore-learning-review-e2e-/)
  assert.match(workflow, /-mentor@example\.com/)
  assert.match(workflow, /-learner@example\.com/)
  assert.match(ssmHelper, /ssm[\s\S]*send-command/i)

  assert.match(browserScript, /\/auth\/sign-up/)
  assert.match(browserScript, /\/auth\/sign-in/)
  assert.match(browserScript, /\/learn\/courses\//)
  assert.match(browserScript, /Enroll free/)
  assert.match(browserScript, /Your response/)
  assert.match(browserScript, /Submit for review/)
  assert.match(browserScript, /Awaiting mentor review/)
  assert.match(browserScript, /\/learn\/studio/)
  assert.match(browserScript, /Pending learner reviews/)
  assert.match(browserScript, /Review assignments/)
  assert.match(browserScript, /Review submission/)
  assert.match(browserScript, /Score \/ 100/)
  assert.match(browserScript, /Feedback/)
  assert.match(browserScript, /Pass/)
  assert.match(browserScript, /Assignment passed and material completed\./)
  assert.match(browserScript, /Mentor feedback:/)
  assert.match(browserScript, /Unlocked after mentor pass/)
})

test('fixture setup is prefix-constrained and does not directly create learner attempts or grades', () => {
  const remote = readFileSync(remoteScriptPath, 'utf8')

  assert.match(remote, /sea-n-shore-learning-review-e2e-/)
  assert.match(remote, /E2E Learning Review Course/)
  assert.match(remote, /admin-confirm-sign-up/)
  assert.match(remote, /learning_mentor_applications/i)
  assert.match(remote, /learning_mentors/i)
  assert.match(remote, /learning_courses/i)
  assert.match(remote, /learning_course_sections/i)
  assert.match(remote, /learning_lessons/i)
  assert.match(remote, /learning_assignments/i)
  assert.doesNotMatch(remote, /insert\s+into\s+public\.learning_assignment_attempts/i)
  assert.doesNotMatch(remote, /update\s+public\.learning_assignment_attempts/i)
  assert.doesNotMatch(remote, /insert\s+into\s+public\.learning_progress/i)
})

test('read-only audit proves learner submission, mentor grading, completion and unlock', () => {
  const remote = readFileSync(remoteScriptPath, 'utf8')

  assert.match(remote, /verify-submitted\)/)
  assert.match(remote, /status::text='submitted'/i)
  assert.match(remote, /LEARNING_ASSIGNMENT_REVIEW_E2E_SUBMISSION_VERIFIED=true/)
  assert.match(remote, /verify-passed\)/)
  assert.match(remote, /status::text='graded'/i)
  assert.match(remote, /passed=true/i)
  assert.match(remote, /learning_progress/i)
  assert.match(remote, /LEARNING_ASSIGNMENT_REVIEW_E2E_PASS_VERIFIED=true/)
})

test('cleanup is unconditional, prefix constrained and removes all disposable learning artifacts', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const remote = readFileSync(remoteScriptPath, 'utf8')

  assert.match(workflow, /if:\s*always\(\)/)
  assert.match(remote, /cleanup\)/)
  assert.match(remote, /delete from public\.learning_enrollments/i)
  assert.match(remote, /delete from public\.learning_courses/i)
  const enrollmentDelete = remote.search(/delete from public\.learning_enrollments/i)
  const courseDelete = remote.search(/delete from public\.learning_courses/i)
  assert.ok(
    enrollmentDelete >= 0 && courseDelete > enrollmentDelete,
    'disposable learner enrollment must be deleted before its restrict-protected course',
  )
  assert.match(remote, /delete from public\.learning_mentors/i)
  assert.match(remote, /delete from public\.learning_mentor_applications/i)
  assert.match(remote, /delete from public\.user_roles/i)
  assert.match(remote, /delete from public\.profiles/i)
  assert.match(remote, /admin-delete-user/)
  assert.match(remote, /LEARNING_ASSIGNMENT_REVIEW_E2E_CLEANUP_VERIFIED=true/)
})
