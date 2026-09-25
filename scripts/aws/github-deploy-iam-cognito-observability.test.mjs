import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const bootstrap = readFileSync('infra/aws/bootstrap/main.tf', 'utf8')
const reconcile = readFileSync('scripts/aws/github-deploy-iam.sh', 'utf8')

test('GitHub deploy role has read-only Cognito signup capacity telemetry access', () => {
  for (const source of [bootstrap, reconcile]) {
    assert.match(source, /ReviewCognitoSignupCapacity/)
    assert.match(source, /cognito-idp:GetProvisionedLimit/)
    assert.match(source, /cloudwatch:GetMetricStatistics/)
    assert.doesNotMatch(source, /cognito-idp:UpdateProvisionedLimit/)
    assert.doesNotMatch(source, /servicequotas:RequestServiceQuotaIncrease/)
  }

  assert.match(reconcile, /verify_cognito_signup_capacity_statement/)
})
