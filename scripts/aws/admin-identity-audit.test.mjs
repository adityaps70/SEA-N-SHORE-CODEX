import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('admin identity audit is read-only, guarded and never prints addresses or numbers', async () => {
  const scriptUrl = new URL('./admin-identity-audit.sh', import.meta.url)
  const actionUrl = new URL('./admin-identity-audit-action.txt', import.meta.url)
  const workflowUrl = new URL('../../.github/workflows/aws-admin-identity-audit.yml', import.meta.url)

  assert.equal(existsSync(scriptUrl), true)
  assert.equal(existsSync(actionUrl), true)
  assert.equal(existsSync(workflowUrl), true)

  const action = (await readFile(actionUrl, 'utf8')).trim()
  assert.ok(['plan', 'audit-once'].includes(action))

  const script = await readFile(scriptUrl, 'utf8')
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /ADMIN_IDENTITY_AUDIT_EXPECTED_SHA/)
  assert.match(script, /plan\) echo "ADMIN_IDENTITY_AUDIT_SKIPPED=true"; exit 0 ;;/)
  assert.match(script, /ADMIN_IDENTITY_AUDIT_FOCUS_SIGN_IN=/)
  assert.match(script, /ADMIN_IDENTITY_AUDIT_SUSPENDED_MEMBERS_WITH_ENABLED_SIGN_INS=/)
  assert.match(script, /ADMIN_IDENTITY_AUDIT_UNMAPPED_SIGNABLE_USERS=/)
  assert.match(script, /ADMIN_IDENTITY_AUDIT_PHONE_ONLY_USERS=/)
  assert.match(script, /ADMIN_IDENTITY_AUDIT_READ_ONLY_VERIFIED=true/)
  // Read-only: no Cognito or database writes of any kind.
  for (const write of [/admin-(delete|disable|enable|update|link|create)/, /forgot-password/, /\b(insert|update|delete)\s+(into|from|public\.)/i, /global-sign-out/]) {
    assert.doesNotMatch(script, write)
  }
  // Addresses and numbers are compared through a digest and never printed.
  // Addresses and numbers never become an output field.
  assert.doesNotMatch(script, /'(email|phone_number|phone)':/)
  assert.doesNotMatch(script, /print\(f?'[^']*\{[^}]*(email|phone_number)[^}]*\}/)

  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /name: AWS Admin Identity Audit/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Guard audit against a moved branch/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /ADMIN_IDENTITY_AUDIT_EXPECTED_SHA/)
})
