// Round 15: guarded release path and Terraform contract for retiring phone/SMS sign-in (custom auth,
// challenge Lambdas, OTP limits, SMS alarms) and adding the deep health check token secret.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const script = await read('./sms-retirement-infra.sh')
const action = guardAction(await read('./sms-retirement-infra-action.txt'))
const workflow = await read('../../.github/workflows/aws-sms-retirement-infra.yml')
const ci = await read('../../.github/workflows/aws-infra-ci.yml')
const auth = await read('../../infra/aws/app/auth.tf')
const hardening = await read('../../infra/aws/app/security-hardening.tf')
const healthToken = await read('../../infra/aws/app/health-check-token.tf')
const main = await read('../../infra/aws/app/main.tf')

test('the runner is guarded like the other bootstrap-host Terraform runners', () => {
  assert.ok(['plan', 'apply-once'].includes(action))
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /SMS_RETIREMENT_INFRA_EXPECTED_SHA/)
  assert.match(script, /jq -e '\.lineage == "197a6fae-9997-636e-e52b-c3ac6da85d90"'/)
  const account = script.search(/get-caller-identity/)
  const lock = script.indexOf('source scripts/aws/bootstrap-terraform-lock.sh')
  assert.ok(account > 0 && lock > account, 'host lock right after the account check')
  assert.match(script, /export TMPDIR="\$TF_TMPDIR"/)
  assert.doesNotMatch(script, /^terraform -chdir="\$APP_DIR" plan /m, 'plans are bounded')
  assert.match(script, /terraform_plan_bounded "\$WORK_DIR\/plan\.log" -chdir="\$APP_DIR" plan /)
  // Saved-plan apply only, after the branch and state backup checks.
  assert.match(script, /terraform -chdir="\$APP_DIR" apply -input=false -no-color "\$WORK_DIR\/sms-retirement\.tfplan"/)
  assert.doesNotMatch(script, /-auto-approve|terraform[^\n]* destroy|state rm/)
  const applyAt = script.indexOf('apply -input=false -no-color "$WORK_DIR/sms-retirement.tfplan"')
  assert.ok(script.indexOf('bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1') < applyAt)
  assert.ok(script.indexOf('STATE_BACKUP_VERSION=') < applyAt)
  assert.ok(script.indexOf('SMS_RETIREMENT_PLAN_ONLY_NO_APPLY') < applyAt)
  assert.match(script, /SMS retirement resources still drift after apply/)
  // Never reads or prints the token, phone numbers or emails.
  assert.doesNotMatch(script, /get-secret-value|SecretString|secret_string/)
  assert.doesNotMatch(script, /PHONE_ONLY_USER=[^\n]*(phone_number|email)\)/)

  assert.match(workflow, /name: AWS SMS Retirement Infrastructure/)
  assert.match(workflow, /group: sea-n-shore-sms-retirement-infra\n  cancel-in-progress: false/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Guard infrastructure operation against a moved branch/)
  assert.match(workflow, /apply-once is allowed only from an exact branch push/)
  assert.match(workflow, /export SMS_RETIREMENT_INFRA_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /bash scripts\/aws\/sms-retirement-infra\.sh/)
  assert.match(workflow, /grep -q 'SMS_RETIREMENT_PLAN_VERIFIED=true'/)
  assert.match(workflow, /grep -q 'SMS_RETIREMENT_PLAN_ONLY_NO_APPLY'/)
  assert.match(workflow, /grep -q 'SMS_RETIREMENT_APPLY_VERIFIED=true'/)
  for (const path of ['infra/aws/app/auth.tf', 'infra/aws/app/security-hardening.tf', 'infra/aws/app/health-check-token.tf', 'scripts/aws/sms-retirement-infra-action.txt']) {
    assert.ok(workflow.split('\njobs:')[0].includes(`- ${path}\n`), path)
  }
  assert.ok(!workflow.split('\njobs:')[0].includes('- infra/aws/app/main.tf\n'))
  assert.match(ci, /node --test scripts\/aws\/sms-retirement-infra\.test\.mjs/)
})

test('post-apply evidence proves custom auth is gone without sending any SMS', () => {
  for (const marker of [
    'SMS_RETIREMENT_DRIFT_FREE', 'CUSTOM_AUTH_FLOW_DISABLED', 'CUSTOM_AUTH_TRIGGERS_DETACHED', 'CUSTOM_AUTH_INITIATE_REJECTED',
    'CUSTOM_AUTH_LAMBDAS_ABSENT', 'OTP_LIMITS_TABLE_ABSENT', 'HEALTH_CHECK_TOKEN_SECRET_VERIFIED',
    'HEALTH_CHECK_TOKEN_EXECUTION_POLICY_VERIFIED', 'PUBLIC_SITE_LIVE_VERIFIED', 'SMS_RETIREMENT_APPLY_VERIFIED',
  ]) {
    assert.match(script, new RegExp(`${marker}=true`), marker)
  }
  // The CUSTOM_AUTH probe runs only after the flow and the triggers are confirmed gone, with a
  // made-up user on a reserved domain.
  const probe = script.indexOf('--auth-flow CUSTOM_AUTH')
  assert.ok(probe > script.indexOf('CUSTOM_AUTH_FLOW_DISABLED=true'))
  assert.ok(probe > script.indexOf('CUSTOM_AUTH_TRIGGERS_DETACHED=true'))
  assert.match(script, /PROBE_USERNAME="sms-retirement-probe-[^"]+@example\.invalid"/)
  assert.match(script, /Cognito accepted a CUSTOM_AUTH sign-in on the web client/)
  assert.match(script, /InvalidParameterException\|NotAuthorizedException/)
  assert.match(script, /HEALTH_CHECK_TOKEN_SECRET_ARN=\$HEALTH_SECRET_ARN/)
  assert.match(script, /SMSMonthToDateSpentUSD/)
  assert.match(script, /SMS_MONTH_TO_DATE_SPENT_USD=/)
  // Phone-only users: count, sub, created date only.
  assert.match(script, /PHONE_ONLY_USERS_COUNT=/)
  assert.match(script, /"PHONE_ONLY_USER=sub=\\\(\.sub\)\|created=\\\(\.created\)\|status=\\\(\.status\)\|enabled=\\\(\.enabled\)\|kind=\\\(\.kind\)"/)
  assert.match(script, /aws cognito-idp list-users [^\n]*--output json \\\n  \| jq -r/)
})

test('Terraform: no custom auth, no SMS, no OTP table; a random health token readable only by ECS', () => {
  assert.doesNotMatch(auth, /"ALLOW_CUSTOM_AUTH"|define_auth_challenge\s*=|create_auth_challenge\s*=|verify_auth_challenge_response\s*=/)
  assert.doesNotMatch(auth, /cognito_auth_challenge|cognito_(define|create|verify)_auth_challenge|sns:Publish/)
  assert.match(auth, /explicit_auth_flows = \[\n    "ALLOW_USER_PASSWORD_AUTH",\n    "ALLOW_USER_SRP_AUTH",\n    "ALLOW_REFRESH_TOKEN_AUTH",\n  \]/)
  // write_attributes stay unset (Cognito rejected a phone-less list in Round 14).
  assert.doesNotMatch(auth, /write_attributes\s*=/)
  for (const lambda of ['define', 'create', 'verify']) {
    assert.equal(existsSync(new URL(`../../infra/aws/app/lambda/cognito-${lambda}-auth-challenge.mjs`, import.meta.url)), false)
  }
  assert.doesNotMatch(hardening, /resource "aws_dynamodb_table" "otp_limits"|resource "aws_sns_sms_preferences"|sms_spend_high|otp_global_cap/)
  assert.match(hardening, /removed \{\n  from = aws_sns_sms_preferences\.account\n\n  lifecycle \{\n    destroy = false\n  \}\n\}/)

  assert.match(healthToken, /resource "random_password" "health_check_token" \{\n  length  = 64\n  special = false\n\}/)
  assert.match(healthToken, /name\s+= "\$\{local\.name_prefix\}\/health-check-token"/)
  assert.match(healthToken, /secret_string = random_password\.health_check_token\.result/)
  assert.match(healthToken, /role = aws_iam_role\.ecs_execution\.id/)
  assert.match(healthToken, /Action\s+= \["secretsmanager:GetSecretValue"\]\n\s+Resource = aws_secretsmanager_secret\.health_check_token\.arn/)
  assert.doesNotMatch(healthToken, /secretsmanager:\*|PutSecretValue|DeleteSecret|Resource\s+= "\*"/)
  assert.doesNotMatch(healthToken, /output "[^"]*"\s*\{[^}]*random_password/)
  assert.match(main, /name\s+= "HEALTH_CHECK_TOKEN"\n\s+valueFrom = aws_secretsmanager_secret\.health_check_token\.arn/)
  assert.match(main, /aws_iam_role_policy\.ecs_execution_health_check_token_secret,/)
})

// Runs the runner's own plan classifier against synthetic plans.
const classifierStart = script.indexOf(`cat > "$WORK_DIR/classify-plan.py" <<'PY'\n`)
const classifier = script.slice(script.indexOf('\n', classifierStart) + 1, script.indexOf('\nPY\n', classifierStart))

const destroyed = {
  'aws_lambda_function.cognito_define_auth_challenge': { function_name: 'sea-n-shore-staging-cognito-define-auth-challenge' },
  'aws_lambda_function.cognito_create_auth_challenge': { function_name: 'sea-n-shore-staging-cognito-create-auth-challenge' },
  'aws_lambda_function.cognito_verify_auth_challenge': { function_name: 'sea-n-shore-staging-cognito-verify-auth-challenge' },
  'aws_lambda_permission.cognito_define_auth_challenge': { function_name: 'sea-n-shore-staging-cognito-define-auth-challenge' },
  'aws_lambda_permission.cognito_create_auth_challenge': { function_name: 'sea-n-shore-staging-cognito-create-auth-challenge' },
  'aws_lambda_permission.cognito_verify_auth_challenge': { function_name: 'sea-n-shore-staging-cognito-verify-auth-challenge' },
  'aws_cloudwatch_log_group.cognito_define_auth_challenge': { name: '/aws/lambda/sea-n-shore-staging-cognito-define-auth-challenge' },
  'aws_cloudwatch_log_group.cognito_create_auth_challenge': { name: '/aws/lambda/sea-n-shore-staging-cognito-create-auth-challenge' },
  'aws_cloudwatch_log_group.cognito_verify_auth_challenge': { name: '/aws/lambda/sea-n-shore-staging-cognito-verify-auth-challenge' },
  'aws_iam_role.cognito_auth_challenge': { name: 'sea-n-shore-staging-cognito-auth-challenge' },
  'aws_iam_role_policy_attachment.cognito_auth_challenge_logs': { role: 'sea-n-shore-staging-cognito-auth-challenge' },
  'aws_iam_role_policy.cognito_auth_challenge_sms': { name: 'sea-n-shore-staging-cognito-auth-challenge-sms' },
  'aws_iam_role_policy.cognito_auth_challenge_otp_limits': { name: 'sea-n-shore-staging-cognito-auth-challenge-otp-limits' },
  'aws_iam_role_policy.ecs_task_otp_limits': { name: 'sea-n-shore-staging-otp-limits-runtime' },
  'aws_dynamodb_table.otp_limits': { name: 'sea-n-shore-staging-otp-limits' },
  'aws_cloudwatch_metric_alarm.sms_spend_high': { alarm_name: 'sea-n-shore-staging-sms-spend-high' },
  'aws_cloudwatch_log_metric_filter.otp_global_cap': { name: 'sea-n-shore-staging-otp-global-cap' },
  'aws_cloudwatch_metric_alarm.otp_global_cap': { alarm_name: 'sea-n-shore-staging-otp-global-cap-reached' },
}
const lambdaBefore = {
  define_auth_challenge: 'arn:aws:lambda:ap-south-1:310356785722:function:sea-n-shore-staging-cognito-define-auth-challenge',
  create_auth_challenge: 'arn:aws:lambda:ap-south-1:310356785722:function:sea-n-shore-staging-cognito-create-auth-challenge',
  verify_auth_challenge_response: 'arn:aws:lambda:ap-south-1:310356785722:function:sea-n-shore-staging-cognito-verify-auth-challenge',
  pre_sign_up: 'arn:aws:lambda:ap-south-1:310356785722:function:sea-n-shore-staging-cognito-pre-sign-up-link',
  kms_key_id: 'arn:aws:kms:ap-south-1:310356785722:key/abc',
  custom_email_sender: [{ lambda_arn: 'arn:aws:lambda:ap-south-1:310356785722:function:sea-n-shore-staging-cognito-resend-email-sender', lambda_version: 'V1_0' }],
}
const lambdaAfter = { ...lambdaBefore, define_auth_challenge: null, create_auth_challenge: null, verify_auth_challenge_response: null }
const flowsBefore = ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_USER_SRP_AUTH', 'ALLOW_CUSTOM_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH']
const flowsAfter = ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH']

const change = (address, actions, before, after, afterUnknown = {}) => ({ address, mode: 'managed', change: { actions, before, after, after_unknown: afterUnknown } })
function validPlan() {
  return [
    ...Object.entries(destroyed).map(([address, before]) => change(address, ['delete'], before, null)),
    change('aws_sns_sms_preferences.account', ['forget'], { monthly_spend_limit: '1' }, null),
    change('random_password.health_check_token', ['create'], null, { length: 64, special: false }, { result: true }),
    change('aws_secretsmanager_secret.health_check_token', ['create'], null, { name: 'sea-n-shore-staging/health-check-token' }, { arn: true }),
    change('aws_secretsmanager_secret_version.health_check_token', ['create'], null, {}, { secret_string: true }),
    change('aws_iam_role_policy.ecs_execution_health_check_token_secret', ['create'], null, { role: 'sea-n-shore-staging-ecs-execution', name: 'sea-n-shore-staging-health-check-token-secret' }, { policy: true }),
    change('aws_cognito_user_pool.app', ['update'], { name: 'sea-n-shore-staging-users', mfa_configuration: 'OPTIONAL', lambda_config: [lambdaBefore] }, { name: 'sea-n-shore-staging-users', mfa_configuration: 'OPTIONAL', lambda_config: [lambdaAfter] }),
    change('aws_cognito_user_pool_client.web', ['update'], { name: 'sea-n-shore-staging-web', explicit_auth_flows: flowsBefore }, { name: 'sea-n-shore-staging-web', explicit_auth_flows: flowsAfter }),
  ]
}

async function classify(resourceChanges) {
  const dir = await mkdtemp(join(tmpdir(), 'sms-retirement-plan-'))
  try {
    const planPath = join(dir, 'plan.json')
    const classifierPath = join(dir, 'classify.py')
    await writeFile(planPath, JSON.stringify({ resource_changes: resourceChanges }))
    await writeFile(classifierPath, classifier)
    const run = spawnSync('python3', [classifierPath, planPath], { encoding: 'utf8' })
    return { ok: run.status === 0, output: `${run.stdout}${run.stderr}` }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const replace = (plan, address, edit) => plan.map((r) => (r.address === address ? edit(structuredClone(r)) : r))

test('the classifier accepts exactly the SMS retirement and health token changes', async () => {
  const accepted = await classify(validPlan())
  assert.equal(accepted.ok, true, accepted.output)
  assert.match(accepted.output, /SMS_RETIREMENT_PLAN_CHANGES=25/)
  assert.match(accepted.output, /COGNITO_CLIENT_EXPLICIT_AUTH_FLOWS_PLANNED_AFTER=ALLOW_REFRESH_TOKEN_AUTH,ALLOW_USER_PASSWORD_AUTH,ALLOW_USER_SRP_AUTH/)
  assert.match(accepted.output, /COGNITO_LAMBDA_TRIGGERS_PLANNED_AFTER=custom_email_sender,kms_key_id,pre_sign_up/)
  assert.match(accepted.output, /SMS_RETIREMENT_KEYS=aws_cognito_user_pool\.app\|lambda_config/)

  // The pool and client may already have been updated by the multi-login auth runner.
  const alreadyUpdated = await classify(validPlan().filter((r) => !r.address.startsWith('aws_cognito_')))
  assert.equal(alreadyUpdated.ok, true, alreadyUpdated.output)
  assert.match(alreadyUpdated.output, /SMS_RETIREMENT_PLAN_CHANGES=23/)
})

test('the classifier refuses anything outside the allowlist', async () => {
  const cases = [
    ['an unrelated change', [...validPlan(), change('aws_ecs_service.web', ['update'], { desired_count: 2 }, { desired_count: 1 })], /unexpected change aws_ecs_service\.web/],
    ['an unrelated destroy', [...validPlan(), change('aws_lambda_function.cognito_pre_sign_up_link', ['delete'], { function_name: 'x' }, null)], /unexpected change/],
    ['replacing the user pool', replace(validPlan(), 'aws_cognito_user_pool.app', (r) => ((r.change.actions = ['delete', 'create']), r)), /may only be updated in place/],
    ['another pool attribute', replace(validPlan(), 'aws_cognito_user_pool.app', (r) => ((r.change.after.mfa_configuration = 'OFF'), r)), /user pool change outside lambda_config/],
    ['dropping the pre-sign-up trigger', replace(validPlan(), 'aws_cognito_user_pool.app', (r) => ((r.change.after.lambda_config[0].pre_sign_up = null), r)), /lambda_config change outside the custom auth triggers/],
    ['keeping a custom trigger', replace(validPlan(), 'aws_cognito_user_pool.app', (r) => ((r.change.after.lambda_config[0].create_auth_challenge = lambdaBefore.create_auth_challenge), r)), /custom auth triggers must be detached/],
    ['another client attribute', replace(validPlan(), 'aws_cognito_user_pool_client.web', (r) => ((r.change.after.callback_urls = ['https://evil.example/cb']), r)), /web client change outside explicit_auth_flows/],
    ['client write attributes', replace(validPlan(), 'aws_cognito_user_pool_client.web', (r) => ((r.change.after.write_attributes = ['email']), r)), /web client change outside explicit_auth_flows/],
    ['dropping SRP sign-in', replace(validPlan(), 'aws_cognito_user_pool_client.web', (r) => ((r.change.after.explicit_auth_flows = ['ALLOW_REFRESH_TOKEN_AUTH', 'ALLOW_USER_PASSWORD_AUTH']), r)), /exactly password, SRP and refresh-token/],
    ['destroying the SMS preferences', replace(validPlan(), 'aws_sns_sms_preferences.account', (r) => ((r.change.actions = ['delete']), r)), /may only be forgotten/],
    ['destroying a different table', replace(validPlan(), 'aws_dynamodb_table.otp_limits', (r) => ((r.change.before.name = 'sea-n-shore-staging-realtime-connections'), r)), /not the expected object/],
    ['replacing the OTP table', replace(validPlan(), 'aws_dynamodb_table.otp_limits', (r) => ((r.change.actions = ['delete', 'create']), r)), /may only be destroyed/],
    ['a short token', replace(validPlan(), 'random_password.health_check_token', (r) => ((r.change.after.length = 16), r)), /64 random alphanumeric/],
    ['the token policy on the task role', replace(validPlan(), 'aws_iam_role_policy.ecs_execution_health_check_token_secret', (r) => ((r.change.after.role = 'sea-n-shore-staging-ecs-task'), r)), /ECS execution role only/],
    ['a missing removal', validPlan().filter((r) => r.address !== 'aws_dynamodb_table.otp_limits'), /expected changes are missing from the plan: aws_dynamodb_table\.otp_limits/],
  ]
  for (const [label, plan, pattern] of cases) {
    const result = await classify(plan)
    assert.equal(result.ok, false, `${label} must be refused`)
    assert.match(result.output, pattern, label)
  }
})

test('after the apply an empty SMS retirement plan reads as already applied, and apply-once refuses it', async () => {
  const result = await classify([])
  assert.equal(result.ok, true, result.output)
  assert.match(result.output, /SMS_RETIREMENT_ALREADY_APPLIED=true/)
  const script = await readFile(new URL('./sms-retirement-infra.sh', import.meta.url), 'utf8')
  assert.match(script, /SMS retirement is already applied; nothing to apply\./)
})
