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


test('GitHub deploy role may update only the exact staging Cognito user pool for bounded email rollback', () => {
  for (const source of [bootstrap, reconcile]) {
    assert.match(source, /cognito-idp:UpdateUserPool/)
  }

  assert.match(bootstrap, /Resource\s*=\s*"arn:aws:cognito-idp:\$\{var\.aws_region\}:\$\{data\.aws_caller_identity\.current\.account_id\}:userpool\/\$\{var\.phase5b_cognito_user_pool_id\}"/)
  assert.match(reconcile, /Phase5bCognitoRead/)
  assert.match(reconcile, /COGNITO_POOL_ARN/)
  assert.match(reconcile, /verify_phase5b_cognito_pool_statement/)
  assert.doesNotMatch(reconcile, /cognito-idp:UpdateUserPool"\],\s*Resource:\s*"\*"/)
})
