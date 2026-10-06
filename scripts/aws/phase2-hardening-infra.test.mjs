// Round 14 Phase 2 (2.1, 2.14): guarded release path and Terraform contract for the media
// lifecycle and ALB access logs and hardening.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const script = await read('./phase2-hardening-infra.sh')
const action = guardAction(await read('./phase2-hardening-infra-action.txt'))
const workflow = await read('../../.github/workflows/aws-phase2-hardening-infra.yml')
const ci = await read('../../.github/workflows/aws-infra-ci.yml')
const hardening = await read('../../infra/aws/app/phase2-hardening.tf')
const main = await read('../../infra/aws/app/main.tf')

test('the runner is guarded and accepts only the intended creates and exact updates', () => {
  assert.ok(['plan', 'apply-once'].includes(action))
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /PHASE2_HARDENING_EXPECTED_SHA/)
  assert.match(script, /unexpected phase 2 hardening change refused/)
  assert.match(script, /change outside its intended attributes refused/)
  assert.match(script, /'aws_lb\.app': \{'enable_deletion_protection', 'drop_invalid_header_fields', 'access_logs'\}/)
  // The web service is not planned: that would also plan the deploy-managed task definition.
  assert.doesNotMatch(script, /aws_ecs_service\.web/)
  const allowList = script.slice(script.indexOf('allowed = {'), script.indexOf('}\nupdate_keys'))
  // Never a replace or destroy, and never the media bucket itself, the database, the pool or CloudFront.
  assert.doesNotMatch(allowList, /'delete'|'aws_s3_bucket\.app|'aws_rds|'aws_cognito_user_pool|'aws_cloudfront/)
  for (const marker of ['MEDIA_LIFECYCLE_VERIFIED', 'ALB_ATTRIBUTES_VERIFIED', 'ALB_ACCESS_LOG_DELIVERY_VERIFIED', 'ECS_SERVICE_STEADY', 'PUBLIC_SITE_LIVE_VERIFIED', 'PHASE2_HARDENING_APPLY_VERIFIED']) {
    assert.match(script, new RegExp(`${marker}=true`))
  }
  assert.match(script, /export TMPDIR="\$TF_TMPDIR"/)
  assert.doesNotMatch(script, /-auto-approve/)
  assert.match(workflow, /name: AWS Phase 2 Hardening Infrastructure/)
  assert.match(workflow, /export PHASE2_HARDENING_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /Guard infrastructure operation against a moved branch/)
  assert.match(ci, /node --test scripts\/aws\/phase2-hardening-infra\.test\.mjs/)
})

test('media versions and abandoned uploads expire; ALB logs are kept 90 days over TLS only', () => {
  assert.match(hardening, /resource "aws_s3_bucket_lifecycle_configuration" "media"[\s\S]*?noncurrent_days = 30[\s\S]*?days_after_initiation = 1/)
  assert.match(hardening, /resource "aws_s3_bucket_lifecycle_configuration" "alb_logs"[\s\S]*?days = 90/)
  assert.match(hardening, /Principal = \{ AWS = data\.aws_elb_service_account\.current\.arn \}/)
  assert.match(hardening, /"aws:SecureTransport" = "false"/)
})

test('the ALB is hardened', () => {
  assert.match(main, /enable_deletion_protection = true/)
  assert.match(main, /drop_invalid_header_fields = true/)
  assert.match(main, /access_logs \{\s*\n\s*bucket\s*=\s*aws_s3_bucket\.alb_logs\.id/)
})
