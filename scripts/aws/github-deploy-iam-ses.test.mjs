import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const bootstrap = readFileSync('infra/aws/bootstrap/main.tf', 'utf8')
const reconcile = readFileSync('scripts/aws/github-deploy-iam.sh', 'utf8')

test('GitHub deploy role scopes Phase 5B SES identity access to the Route53 launch domain', () => {
  for (const source of [bootstrap, reconcile]) {
    assert.match(source, /Phase5bSesResourceRead/)
    assert.match(source, /Phase5bSesIdentityManage/)
    assert.match(source, /Phase5bSesConfigurationSetCreate/)
    assert.match(source, /Phase5bSesAccountWrite/)
    assert.match(source, /identity\/seanshore\.in/)
    assert.doesNotMatch(source, /identity\/seaandshore\.in/)
  }

  assert.match(reconcile, /verify_phase5b_ses_resource_read_statement/)
  assert.match(reconcile, /verify_phase5b_ses_identity_manage_statement/)
  assert.match(reconcile, /verify_phase5b_ses_configuration_set_create_statement/)
  assert.match(reconcile, /verify_phase5b_ses_account_write_statement/)
  assert.match(reconcile, /ses:GetEmailIdentity/)
  assert.match(reconcile, /ses:GetConfigurationSet/)
  assert.match(reconcile, /ses:CreateEmailIdentity/)
  assert.match(reconcile, /ses:PutEmailIdentityConfigurationSetAttributes/)
  assert.match(reconcile, /ses:PutEmailIdentityDkimSigningAttributes/)
  assert.match(reconcile, /ses:UpdateEmailIdentityPolicy/)
  assert.match(reconcile, /ses:CreateConfigurationSet/)
  assert.match(reconcile, /ses:PutAccountDetails/)
  assert.doesNotMatch(reconcile, /ses:\*/i)
})
