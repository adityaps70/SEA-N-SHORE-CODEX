// Round 14 Phase 1: guarded release path and Terraform contract for SMS abuse limits, the
// liveness health check and owner-facing alarms.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const script = await read('./security-hardening-infra.sh')
const action = (await read('./security-hardening-infra-action.txt')).trim()
const workflow = await read('../../.github/workflows/aws-security-hardening-infra.yml')
const hardening = await read('../../infra/aws/app/security-hardening.tf')
const auth = await read('../../infra/aws/app/auth.tf')
const main = await read('../../infra/aws/app/main.tf')
const realtime = await read('../../infra/aws/app/realtime.tf')
const social = await read('../../infra/aws/app/social-events.tf')
const multiLogin = await read('./multi-login-auth-infra.sh')

test('security hardening runner is guarded and refuses anything outside its intended changes', () => {
  assert.ok(['plan', 'apply-once'].includes(action))
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /SECURITY_HARDENING_INFRA_EXPECTED_SHA/)
  assert.match(script, /unexpected security hardening change refused/)
  assert.match(script, /target group change outside health_check refused/)
  assert.match(script, /change outside alarm\/ok actions refused/)
  assert.match(script, /'aws_dynamodb_table\.otp_limits': \{\('create',\)\}/)
  assert.match(script, /'aws_lb_target_group\.app': \{\('update',\)\}/)
  // The public client is neither targeted nor accepted: Cognito rejected the phone-less list.
  assert.doesNotMatch(script, /aws_cognito_user_pool_client\.web|'aws_cognito_user_pool\.app'|'aws_ecs_service|'aws_lb\.app'|'aws_cloudfront/)
  assert.match(script, /TARGET_GROUP_LIVENESS_VERIFIED=true/)
  assert.match(script, /OTP_LAMBDA_VERIFIED=true/)
  assert.match(script, /SECURITY_HARDENING_APPLY_VERIFIED=true/)
  assert.match(script, /export TMPDIR="\$TF_TMPDIR"/)
  assert.doesNotMatch(script, /-auto-approve/)
  assert.match(workflow, /name: AWS Security Hardening Infrastructure/)
  assert.match(workflow, /export SECURITY_HARDENING_INFRA_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /Guard infrastructure operation against a moved branch/)
})

test('phone OTP limits, SMS spend cap and topic-proof SNS policy are in Terraform', () => {
  assert.match(hardening, /resource "aws_dynamodb_table" "otp_limits"/)
  assert.match(hardening, /attribute_name = "expiresAt"/)
  assert.match(hardening, /billing_mode = "PAY_PER_REQUEST"/)
  assert.match(hardening, /Action\s+= \["dynamodb:UpdateItem"\]\s*\n\s*Resource = aws_dynamodb_table\.otp_limits\.arn/)
  assert.match(hardening, /resource "aws_sns_sms_preferences" "account"/)
  assert.match(hardening, /default_sms_type\s*=\s*"Transactional"/)
  // USD 1 until AWS raises the account's SMS quota (SNS rejects a limit above the quota).
  assert.match(hardening, /variable "sms_monthly_spend_limit_usd"[\s\S]*?default\s*=\s*1\n/)
  assert.match(hardening, /variable "allowed_phone_calling_codes"[\s\S]*?default\s*=\s*"91"/)
  assert.match(hardening, /SMSMonthToDateSpentUSD/)
  assert.match(hardening, /otp_global_cap_reached/)
  assert.match(auth, /OTP_LIMITS_TABLE\s*=\s*aws_dynamodb_table\.otp_limits\.name/)
  assert.match(auth, /Sid\s*=\s*"NeverPublishToTopics"\s*\n\s*Effect\s*=\s*"Deny"/)
})

test('the public client keeps its attributes until a Cognito-accepted list is known', () => {
  // Cognito rejected the phone-less write_attributes list during the Phase 1 apply.
  assert.doesNotMatch(auth, /write_attributes\s*=/)
  assert.match(auth, /Invalid write attributes specified/)
})

test('ALB and container check the cheap liveness route', () => {
  assert.match(main, /path\s*=\s*"\/api\/health\/live"/)
  assert.match(main, /fetch\('http:\/\/127\.0\.0\.1:3000\/api\/health\/live'\)/)
})

test('every alarm notifies the owner through the alerts topic', () => {
  for (const [file, names] of [[realtime, ['realtime_dlq_depth', 'realtime_queue_age']], [social, ['notification_dlq_depth', 'notification_queue_age']], [hardening, ['sms_spend_high', 'otp_global_cap', 'aurora_cpu_high', 'aurora_capacity_at_max', 'aurora_connections_high']]]) {
    for (const name of names) {
      const start = file.indexOf(`"aws_cloudwatch_metric_alarm" "${name}"`)
      assert.ok(start >= 0, name)
      assert.match(file.slice(start, start + 1500), /alarm_actions\s*=\s*\[aws_sns_topic\.alerts\.arn\]/, name)
    }
  }
})

test('the multi-login auth plan accepts the challenge Lambda\'s new dependencies', () => {
  assert.match(multiLogin, /'aws_dynamodb_table\.otp_limits',/)
  assert.match(multiLogin, /'aws_iam_role_policy\.cognito_auth_challenge_otp_limits',/)
})
