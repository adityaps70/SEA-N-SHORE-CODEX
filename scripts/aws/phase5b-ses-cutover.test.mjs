import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const scriptUrl = new URL('./phase5b-ses-cutover.sh', import.meta.url)
const workflowUrl = new URL('../../.github/workflows/aws-phase5b-ses.yml', import.meta.url)
const actionUrl = new URL('./phase5b-action.txt', import.meta.url)

test('Phase 5B cutover helper exposes only the approved bounded operations', () => {
  const script = fs.readFileSync(scriptUrl, 'utf8')

  assert.match(script, /discover/)
  assert.match(script, /ensure-identity/)
  assert.match(script, /verify-ready/)
  assert.match(script, /cutover/)
  assert.match(script, /verify-cutover/)
  assert.match(script, /rollback-cognito/)
  assert.match(script, /Sea N Shore <no-reply@seaandshore\.in>/)
  assert.match(script, /sea-n-shore-staging-transactional/)
  assert.match(script, /sesv2 get-account/)
  assert.match(script, /sesv2 get-email-identity/)
  assert.match(script, /cognito-idp describe-user-pool/)
  assert.match(script, /cognito-idp update-user-pool/)
  assert.match(script, /EmailSendingAccount=DEVELOPER/)
  assert.doesNotMatch(script, /delete-user-pool|delete-email-identity|ses:\*/i)
})

test('Phase 5B cutover helper captures the live user pool before mutation and supports exact rollback', () => {
  const script = fs.readFileSync(scriptUrl, 'utf8')

  assert.match(script, /phase5b-user-pool-before\.json/)
  assert.match(script, /phase5b-email-before\.json/)
  assert.match(script, /update-user-pool --generate-cli-skeleton/)
  assert.match(script, /PHASE5B_ROLLBACK_CAPTURED/)
  assert.match(script, /PHASE5B_COGNITO_CUTOVER_OK/)
  assert.match(script, /PHASE5B_COGNITO_ROLLBACK_OK/)
  assert.match(script, /--require-cutover-ready/)
})

test('Phase 5B GitHub runner is branch-scoped, staging OIDC, action-file driven, and CI gated', () => {
  const workflow = fs.readFileSync(workflowUrl, 'utf8')
  const action = fs.readFileSync(actionUrl, 'utf8').trim()

  assert.equal(action, 'discover')
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /branches:\s*\[feat\/aws-native-phase-0-1\]/)
  assert.match(workflow, /scripts\/aws\/phase5b-action\.txt/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /aws-actions\/configure-aws-credentials@v4/)
  assert.match(workflow, /AWS_ROLE_TO_ASSUME/)
  assert.match(workflow, /head_sha=/)
  assert.match(workflow, /AWS Infrastructure CI/)
  assert.match(workflow, /phase5b-ses-cutover\.sh/)
})
