import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const scriptUrl = new URL('./phase5b-ses-cutover.sh', import.meta.url)
const readinessUrl = new URL('./phase5b-ses-readiness.sh', import.meta.url)
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

test('Phase 5B ensure-identity does not rewrite an existing SES configuration set', () => {
  const script = fs.readFileSync(scriptUrl, 'utf8')

  const start = script.indexOf('ensure_configuration_set()')
  const end = script.indexOf('\n}\n\nprint_identity_state()', start)
  assert.ok(start >= 0 && end > start)
  const ensureConfigurationSet = script.slice(start, end)

  assert.match(ensureConfigurationSet, /sesv2 get-configuration-set/)
  assert.match(ensureConfigurationSet, /return/)
  assert.match(ensureConfigurationSet, /sesv2 create-configuration-set/)
  assert.doesNotMatch(ensureConfigurationSet, /put-configuration-set-/)
})

test('Phase 5B resolves the exact Cognito pool from live ECS instead of listing user pools', () => {
  const script = fs.readFileSync(scriptUrl, 'utf8')
  const readiness = fs.readFileSync(readinessUrl, 'utf8')

  for (const source of [script, readiness]) {
    assert.match(source, /ecs describe-services/)
    assert.match(source, /ecs describe-task-definition/)
    assert.match(source, /AWS_COGNITO_USER_POOL_ID/)
    assert.doesNotMatch(source, /cognito-idp list-user-pools/)
  }
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
  const allowedActions = new Set([
    'discover',
    'ensure-identity',
    'verify-ready',
    'cutover',
    'verify-cutover',
    'rollback-cognito',
  ])

  assert.ok(allowedActions.has(action), `Unsupported Phase 5B action: ${action}`)
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
