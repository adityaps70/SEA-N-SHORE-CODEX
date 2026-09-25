import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const bootstrap = readFileSync('infra/aws/bootstrap/main.tf', 'utf8')
const reconcile = readFileSync('scripts/aws/github-deploy-iam.sh', 'utf8')

test('GitHub deploy role scopes Phase 5B SES identity access to the Route53 launch domain', () => {
  for (const source of [bootstrap, reconcile]) {
    assert.match(source, /Phase5bSesResourceRead/)
    assert.match(source, /Phase5bSesIdentityCreate/)
    assert.match(source, /identity\/seanshore\.in/)
    assert.doesNotMatch(source, /identity\/seaandshore\.in/)
  }

  assert.match(reconcile, /verify_phase5b_ses_resource_read_statement/)
  assert.match(reconcile, /verify_phase5b_ses_identity_create_statement/)
  assert.match(reconcile, /ses:GetEmailIdentity/)
  assert.match(reconcile, /ses:GetConfigurationSet/)
  assert.match(reconcile, /ses:CreateEmailIdentity/)
  assert.doesNotMatch(reconcile, /ses:\*/i)
})
