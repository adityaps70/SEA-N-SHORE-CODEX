// Round 14 Phase 1: guarded release path and Terraform contract for the liveness health check and
// owner-facing alarms. Round 15 retired phone/SMS sign-in, so the SMS abuse limits (OTP table, SMS
// spend cap, SMS/OTP alarms) moved out of this runner and are removed by sms-retirement-infra.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const script = await read('./security-hardening-infra.sh')
const action = guardAction(await read('./security-hardening-infra-action.txt'))
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
  // Round 15: nothing SMS/OTP-related is created or updated by this runner any more.
  assert.doesNotMatch(script, /otp_limits|sns_sms_preferences|sms_spend_high|otp_global_cap|cognito_auth_challenge|cognito_create_auth_challenge/)
  assert.match(script, /'aws_lb_target_group\.app': \{\('update',\)\}/)
  // The public client is neither targeted nor accepted: Cognito rejected the phone-less list.
  assert.doesNotMatch(script, /aws_cognito_user_pool_client\.web|'aws_cognito_user_pool\.app'|'aws_ecs_service|'aws_lb\.app'|'aws_cloudfront/)
  assert.match(script, /TARGET_GROUP_LIVENESS_VERIFIED=true/)
  assert.match(script, /SECURITY_HARDENING_APPLY_VERIFIED=true/)
  assert.match(script, /export TMPDIR="\$TF_TMPDIR"/)
  assert.doesNotMatch(script, /-auto-approve/)
  assert.match(workflow, /name: AWS Security Hardening Infrastructure/)
  assert.match(workflow, /export SECURITY_HARDENING_INFRA_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /Guard infrastructure operation against a moved branch/)
})

test('Round 15: the phone OTP limits, SMS spend cap and SMS publishing are gone from Terraform', () => {
  for (const removed of [
    'resource "aws_dynamodb_table" "otp_limits"',
    'resource "aws_iam_role_policy" "cognito_auth_challenge_otp_limits"',
    'resource "aws_iam_role_policy" "ecs_task_otp_limits"',
    'resource "aws_sns_sms_preferences" "account"',
    '"aws_cloudwatch_metric_alarm" "sms_spend_high"',
    '"aws_cloudwatch_metric_alarm" "otp_global_cap"',
    'resource "aws_cloudwatch_log_metric_filter" "otp_global_cap"',
    'variable "sms_monthly_spend_limit_usd"',
    'variable "allowed_phone_calling_codes"',
  ]) {
    assert.ok(!hardening.includes(removed), removed)
  }
  // The account SMS preferences are forgotten, never destroyed: the USD 1 spend limit stays.
  assert.match(hardening, /removed \{\n  from = aws_sns_sms_preferences\.account\n\n  lifecycle \{\n    destroy = false\n  \}\n\}/)
  assert.doesNotMatch(auth, /sns:Publish|OTP_LIMITS_TABLE|otp_limits|ALLOWED_PHONE_CALLING_CODES/)
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
  for (const [file, names] of [[realtime, ['realtime_dlq_depth', 'realtime_queue_age']], [social, ['notification_dlq_depth', 'notification_queue_age']], [hardening, ['aurora_cpu_high', 'aurora_capacity_at_max', 'aurora_connections_high']]]) {
    for (const name of names) {
      const start = file.indexOf(`"aws_cloudwatch_metric_alarm" "${name}"`)
      assert.ok(start >= 0, name)
      assert.match(file.slice(start, start + 1500), /alarm_actions\s*=\s*\[aws_sns_topic\.alerts\.arn\]/, name)
    }
  }
})

test('Round 15: the multi-login auth plan no longer targets or accepts the retired OTP resources', () => {
  assert.doesNotMatch(multiLogin, /otp_limits|cognito_auth_challenge/)
})
