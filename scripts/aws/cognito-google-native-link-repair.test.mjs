import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Cognito Google/native duplicate repair is guarded and fail-closed', async () => {
  const scriptUrl = new URL('./cognito-google-native-link-repair.sh', import.meta.url)
  const actionUrl = new URL('./cognito-google-native-link-repair-action.txt', import.meta.url)
  const workflowUrl = new URL('../../.github/workflows/aws-cognito-google-native-link-repair.yml', import.meta.url)

  assert.equal(existsSync(scriptUrl), true)
  assert.equal(existsSync(actionUrl), true)
  assert.equal(existsSync(workflowUrl), true)

  const action = (await readFile(actionUrl, 'utf8')).trim()
  assert.ok(['plan', 'repair-once'].includes(action))

  const script = await readFile(scriptUrl, 'utf8')
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /COGNITO_GOOGLE_NATIVE_LINK_REPAIR_EXPECTED_SHA/)
  assert.match(script, /plan\|repair-once/)
  assert.match(script, /UserStatus.*EXTERNAL_PROVIDER/)
  assert.match(script, /email_verified/)
  assert.match(script, /onboarding_completed_at/)
  assert.match(script, /admin-delete-user/)
  assert.match(script, /admin-link-provider-for-user/)
  assert.match(script, /ProviderAttributeName=Cognito_Subject/)
  assert.match(script, /COGNITO_GOOGLE_LINKED_NATIVE_USERS=/)
  assert.match(script, /COGNITO_GOOGLE_LINKED_EMAIL_RESOLUTION_OK=/)
  assert.match(script, /COGNITO_GOOGLE_LINKED_EMAIL_RESOLUTION_MISMATCH=/)
  assert.match(script, /COGNITO_GOOGLE_NATIVE_REPAIR_PLAN_ONLY_NO_APPLY=true/)
  assert.match(script, /COGNITO_GOOGLE_NATIVE_REPAIR_APPLY_VERIFIED=true/)
  assert.doesNotMatch(script, /echo .*candidate\['email'\]/)

  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /name: AWS Cognito Google Native Link Repair/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Guard repair against a moved branch/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /COGNITO_GOOGLE_NATIVE_LINK_REPAIR_EXPECTED_SHA/)
})
