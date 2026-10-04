// Round 14 Batch B: guarded creates for DMARC, the abandoned sign-up sweep's permissions, and the
// least-privilege app role's rotated secret; and the deploy's switch between master and app credentials.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

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
  assert.ok(['plan', 'apply-once'].includes(read('scripts/aws/account-security-infra-action.txt').trim()))
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
  assert.equal(read('scripts/aws/aurora-app-credentials.txt').trim(), 'master')
  assert.match(deploy, /AURORA_APP_SECRET_ARN: ""/)
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
