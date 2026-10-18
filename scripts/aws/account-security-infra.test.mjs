// Round 14 Batch B: guarded creates for DMARC, the abandoned sign-up sweep's permissions, and the
// least-privilege app role's rotated secret; and the deploy's switch between master and app credentials.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (path) => readFileSync(path, 'utf8')
const script = read('scripts/aws/account-security-infra.sh')
const workflow = read('.github/workflows/aws-account-security-infra.yml')
const ci = read('.github/workflows/aws-infra-ci.yml')
const deploy = read('.github/workflows/aws-staging-deploy.yml')
const appRole = read('infra/aws/app/aurora-app-role.tf')
const dmarc = read('infra/aws/app/email-dns.tf')
const cleanupPolicy = read('infra/aws/app/unconfirmed-user-cleanup.tf')
const outboxWorker = read('scripts/workers/publish-outbox.ts')

test('the account security runner only creates the listed resources and proves the app role can log in', () => {
  assert.ok(['plan', 'apply-once'].includes(guardAction(read('scripts/aws/account-security-infra-action.txt'))))
  assert.match(script, /source scripts\/aws\/bootstrap-terraform-lock\.sh/)
  assert.match(script, /r\['change'\]\['actions'\] != \['create'\]/)
  assert.match(script, /unexpected account security change refused/)
  assert.match(script, /The DMARC record must be the seanshore\.in p=quarantine TXT record/)
  assert.match(script, /Unexpected cleanup permissions/)
  assert.ok(script.indexOf('Migration 0066 (sea_n_shore_app) has not run') < script.indexOf('terraform -chdir="$APP_DIR" apply'), 'the role must exist before rotation is enabled')
  for (const marker of ['DMARC_QUARANTINE_VERIFIED', 'OUTBOX_WORKER_CLEANUP_POLICY_VERIFIED', 'APP_SECRET_ROTATION_VERIFIED', 'APP_ROLE_LOGIN_VERIFIED', 'PUBLIC_SITE_LIVE_VERIFIED']) {
    assert.match(script, new RegExp(marker + '=true'))
  }
  assert.match(script, /--secret-arn "\$APP_SECRET_ARN" --database "\$DATABASE_NAME" --sql "SELECT current_user"/)
  assert.doesNotMatch(script, /-auto-approve/)
  assert.match(workflow, /export ACCOUNT_SECURITY_INFRA_EXPECTED_SHA=\{sha\}/)
  assert.match(ci, /node --test scripts\/aws\/account-security-infra\.test\.mjs/)
})

test('Terraform: DMARC p=quarantine without a public personal address, sweep permissions, rotated app secret', () => {
  assert.match(dmarc, /allow_overwrite = true/)
  assert.match(dmarc, /"v=DMARC1; p=quarantine; adkim=r; aspf=r"/)
  assert.match(dmarc, /default     = ""/)
  assert.match(cleanupPolicy, /Action   = \["cognito-idp:ListUsers", "cognito-idp:AdminDeleteUser"\]\n        Resource = aws_cognito_user_pool\.app\.arn/)
  assert.match(appRole, /automatically_after_days = 30/)
  assert.match(appRole, /principal     = "secretsmanager\.amazonaws\.com"\n  source_arn    = aws_secretsmanager_secret\.aurora_app\.arn/)
  assert.match(appRole, /ignore_changes = \[secret_string\]/)
  assert.doesNotMatch(appRole, /rds-data:\*|secretsmanager:\*/)
})

test('the deploy switches web and workers between master and app credentials, and feeds the sweep the pool id', () => {
  // Round 14 (2.12): cut over to the least-privilege app role once 0066 and its secret were live.
  assert.ok(['master', 'app'].includes(read('scripts/aws/aurora-app-credentials.txt').trim()))
  assert.match(deploy, /AURORA_APP_SECRET_ARN: arn:aws:secretsmanager:ap-south-1:310356785722:secret:sea-n-shore-staging\/aurora-app-[A-Za-z0-9]{6}\n/)
  assert.match(deploy, /MODE="\$\(tr -d '\[:space:\]' < scripts\/aws\/aurora-app-credentials\.txt\)"/)
  assert.match(deploy, /secret:sea-n-shore-staging\/aurora-app-\[A-Za-z0-9\]\{6\}\$/)
  assert.match(deploy, /AURORA_USER_SECRET="\$\{DB_CREDENTIALS_SECRET_ARN\}:username::"/)
  assert.match(deploy, /\{"name":"AURORA_SECRET_ARN","value":\$DB_CREDENTIALS_SECRET_ARN\}/)
  assert.match(deploy, /--arg AURORA_USER_SECRET "\$\{DB_CREDENTIALS_SECRET_ARN\}:username::"/)
  assert.match(deploy, /if \[\[ "\$DB_CREDENTIALS_MODE" == app \]\]; then/)
  assert.match(deploy, /Web task definition has no Cognito user pool id/)
  assert.match(deploy, /\{"name":"AWS_COGNITO_USER_POOL_ID","value":\$POOL\}/)
  assert.match(outboxWorker, /process\.env\.AWS_COGNITO_USER_POOL_ID \? createUnconfirmedUserCleanup\(\) : null/)
  assert.match(outboxWorker, /await runUnconfirmedUserSweepIfDue\(\)/)
})

// Round H (H3): the runner also applies one in-place update, the web task's Cognito admin policy gaining exactly
// cognito-idp:AdminSetUserMFAPreference (2FA backup codes reset the authenticator app). Anything else is refused.
const auth = read('infra/aws/app/auth.tf')

test('Terraform: the web task may reset a member\'s authenticator app on the one user pool, and nothing broader', () => {
  const policy = auth.slice(auth.indexOf('resource "aws_iam_role_policy" "ecs_task_cognito_admin"'))
  assert.match(policy, /"cognito-idp:AdminUpdateUserAttributes",\n\s+# Round H \(H3\)[^\n]*\n\s+"cognito-idp:AdminSetUserMFAPreference"\n\s+\]\n\s+Resource = aws_cognito_user_pool\.app\.arn/)
  assert.doesNotMatch(policy, /cognito-idp:\*|Resource\s*=\s*"\*"/)
  assert.equal((auth.match(/AdminSetUserMFAPreference/g) ?? []).length, 1, 'granted once, to the web task only')
  // The pool keeps the old email until the new one is verified (Settings › Account › Change email relies on it).
  assert.match(auth, /user_attribute_update_settings \{\n\s+attributes_require_verification_before_update = \["email"\]\n\s+\}/)
})

test('the runner targets the Cognito admin policy, watches auth.tf and verifies the grant after apply', () => {
  assert.match(script, /TARGETS=\([^)]*aws_iam_role_policy\.ecs_task_cognito_admin\n\)/)
  assert.match(script, /git diff --quiet HEAD -- \\\n  infra\/aws\/app\/auth\.tf \\/)
  assert.match(workflow, /paths:\n\s+- infra\/aws\/app\/auth\.tf/)
  assert.match(workflow, /RUNNER_FILES: "infra\/aws\/app\/auth\.tf /)
  assert.match(script, /ECS_TASK_COGNITO_MFA_RESET_POLICY_VERIFIED=true/)
  assert.match(script, /COGNITO_WEB_CLIENT_TOKEN_REVOCATION=/)
  assert.ok(script.indexOf('ECS_TASK_COGNITO_MFA_RESET_POLICY_VERIFIED') > script.indexOf('terraform -chdir="$APP_DIR" apply'), 'verified after the apply')
})

// Runs the runner's own plan check (the embedded Python) against hand-made plans.
const planCheck = (() => {
  const start = script.indexOf(`python3 - "$WORK_DIR/plan.json" <<'PY'\n`)
  const body = script.slice(start).split('\n').slice(1)
  return body.slice(0, body.indexOf('PY')).join('\n')
})()

const BEFORE_ACTIONS = [
  'cognito-idp:AdminDisableUser',
  'cognito-idp:AdminEnableUser',
  'cognito-idp:AdminDeleteUser',
  'cognito-idp:AdminUserGlobalSignOut',
  'cognito-idp:ListUsers',
  'cognito-idp:AdminCreateUser',
  'cognito-idp:AdminSetUserPassword',
  'cognito-idp:AdminUpdateUserAttributes',
]
const POOL = 'arn:aws:cognito-idp:ap-south-1:310356785722:userpool/ap-south-1_EXAMPLE'
const policyOf = (actions, resource = POOL) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Sid: 'AdministerUserAccounts', Effect: 'Allow', Action: actions, Resource: resource }] })
const cognitoAdminChange = (after, before = policyOf(BEFORE_ACTIONS), actions = ['update']) => ({
  address: 'aws_iam_role_policy.ecs_task_cognito_admin',
  mode: 'managed',
  change: {
    actions,
    before: { name: 'sea-n-shore-staging-cognito-admin-runtime', role: 'sea-n-shore-staging-ecs-task', policy: before },
    after: { name: 'sea-n-shore-staging-cognito-admin-runtime', role: 'sea-n-shore-staging-ecs-task', policy: after },
  },
})

async function runPlanCheck(changes) {
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { spawnSync } = await import('node:child_process')
  const dir = mkdtempSync(join(tmpdir(), 'account-security-plan-'))
  writeFileSync(join(dir, 'plan.json'), JSON.stringify({ resource_changes: changes }))
  writeFileSync(join(dir, 'check.py'), planCheck)
  return spawnSync('python3', ['-I', join(dir, 'check.py'), join(dir, 'plan.json')], { encoding: 'utf8' })
}

test('the plan check accepts only the one added Cognito action', async () => {
  const ok = await runPlanCheck([cognitoAdminChange(policyOf([...BEFORE_ACTIONS, 'cognito-idp:AdminSetUserMFAPreference']))])
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, /ACCOUNT_SECURITY_INFRA_CHANGE=aws_iam_role_policy\.ecs_task_cognito_admin\|update/)

  const refusals = [
    [cognitoAdminChange(policyOf([...BEFORE_ACTIONS, 'cognito-idp:AdminSetUserMFAPreference', 'cognito-idp:AdminGetUser'])), /may only gain cognito-idp:AdminSetUserMFAPreference/],
    [cognitoAdminChange(policyOf([...BEFORE_ACTIONS, 'cognito-idp:AdminSetUserMFAPreference'], '*')), /resource, effect and sid must not change/],
    [cognitoAdminChange(policyOf(['cognito-idp:AdminSetUserMFAPreference'])), /may only gain/],
    [cognitoAdminChange(policyOf([...BEFORE_ACTIONS, 'cognito-idp:AdminSetUserMFAPreference']), policyOf(['cognito-idp:ListUsers'])), /not the expected one/],
    [cognitoAdminChange(policyOf([...BEFORE_ACTIONS, 'cognito-idp:AdminSetUserMFAPreference']), undefined, ['delete', 'create']), /unexpected account security change refused/],
    [[{ address: 'aws_cognito_user_pool.app', mode: 'managed', change: { actions: ['update'], before: {}, after: {} } }], /unexpected account security change refused/],
  ]
  for (const [change, message] of refusals) {
    const result = await runPlanCheck(Array.isArray(change) ? change : [change])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, message)
  }
})
