// Round 14 (1.4) stage A: guarded release path and Terraform contract for the CloudFront-only ALB
// origin (HTTPS listener with a secret header, origin DNS and certificate, CloudFront-only group).
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const script = await read('./edge-origin-lockdown-infra.sh')
const action = (await read('./edge-origin-lockdown-infra-action.txt')).trim()
const workflow = await read('../../.github/workflows/aws-edge-origin-lockdown-infra.yml')
const ci = await read('../../.github/workflows/aws-infra-ci.yml')
const lockdown = await read('../../infra/aws/app/edge-origin-lockdown.tf')
const main = await read('../../infra/aws/app/main.tf')

test('the runner is guarded and refuses anything outside stages A and C', () => {
  assert.ok(['plan', 'apply-once'].includes(action))
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /EDGE_ORIGIN_LOCKDOWN_EXPECTED_SHA/)
  assert.match(script, /unexpected edge origin lockdown change refused/)
  assert.match(script, /ALB change outside security_groups refused/)
  assert.match(script, /ALB must keep its existing security group/)
  // An unknown (not-yet-created) group id is only accepted with a post-apply proof of both groups.
  assert.match(script, /ALB_SECURITY_GROUPS_AFTER=unknown-until-apply/)
  assert.match(script, /SecurityGroups \| sort == \(\[\$base, \$cf\] \| sort\)/)
  assert.match(script, /origin listener default must be a 403 fixed response/)
  assert.match(script, /'aws_lb\.app': \{\('update',\)\}/)
  // Nothing in stage A may touch CloudFront, the ALB's existing group, listeners on 80, or data.
  const allowList = script.slice(script.indexOf('allowed = {'), script.indexOf('}\nplan = json.load'))
  assert.match(allowList, /'aws_lb_listener\.origin_https'/)
  assert.doesNotMatch(allowList, /'aws_cloudfront|'aws_rds|'aws_s3|'aws_cognito/)
  // Stage C: only the open-ingress removal and the port 80 listener deletion, exactly.
  assert.match(allowList, /'aws_security_group\.alb': \{\('update',\)\}/)
  assert.match(allowList, /'aws_lb_listener\.http_forward\[0\]': \{\('delete',\)\}/)
  assert.match(script, /ALB group change outside ingress refused/)
  assert.match(script, /ALB group must end with no port 80 and no 0\.0\.0\.0\/0 ingress/)
  assert.match(script, /ALB_DIRECT_ACCESS_CLOSED=true/)
  // Never close port 80 while CloudFront still uses it.
  assert.match(script, /Stage C refused: CloudFront does not yet reach the ALB over HTTPS/)
  assert.match(script, /OriginProtocolPolicy == "https-only"/)
  // A timed-out (or failed), unused certificate request is replaced create-before-destroy; any
  // other state refuses.
  assert.match(script, /PENDING_VALIDATION\|ISSUED\) ;;/)
  assert.match(script, /VALIDATION_TIMED_OUT\|FAILED\)/)
  assert.match(script, /still in use; refusing to replace it/)
  assert.match(script, /-replace=aws_acm_certificate\.origin_tls/)
  // The post-apply drift plan never re-requests the replacement.
  assert.match(script, /"\$\{AFTER_ARGS\[@\]\}" -var-file="\$WORK_DIR\/variables\.json" -out="\$WORK_DIR\/after\.tfplan"/)
  assert.match(script, /allowed\['aws_acm_certificate\.origin_tls'\] = \{\('create', 'delete'\), \('create',\), \('delete',\)\}/)
  assert.match(script, /only the deposed origin certificate may be deleted on its own/)
  assert.match(script, /ORIGIN_HTTPS_WITHOUT_HEADER/)
  assert.match(script, /\[\[ "\$UNSIGNED" == 403 && "\$SIGNED" == 200 \]\]/)
  assert.match(script, /PUBLIC_SITE_LIVE_VERIFIED=true/)
  assert.match(script, /EDGE_ORIGIN_LOCKDOWN_APPLY_VERIFIED=true/)
  assert.match(script, /export TMPDIR="\$TF_TMPDIR"/)
  assert.doesNotMatch(script, /-auto-approve/)
  // The secret is only ever written to a private temp file, never echoed.
  assert.doesNotMatch(script, /echo[^\n]*origin_verify|echo[^\n]*SecretString/)
  assert.match(workflow, /name: AWS Edge Origin Lockdown Infrastructure/)
  assert.match(workflow, /export EDGE_ORIGIN_LOCKDOWN_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /Guard infrastructure operation against a moved branch/)
  assert.match(workflow, /apply-once is allowed only from an exact branch push/)
  assert.match(ci, /node --test scripts\/aws\/edge-origin-lockdown-infra\.test\.mjs/)
})

test('the ALB origin forwards only with the secret header and is reachable from CloudFront', () => {
  assert.match(lockdown, /resource "aws_lb_listener" "origin_https"[\s\S]*?port\s*=\s*443[\s\S]*?status_code\s*=\s*"403"/)
  assert.match(lockdown, /certificate_arn\s*=\s*aws_acm_certificate_validation\.origin_tls\.certificate_arn/)
  assert.match(lockdown, /http_header_name = "X-Origin-Verify"\s*\n\s*values\s*=\s*\[random_password\.origin_verify\.result\]/)
  assert.match(lockdown, /resource "random_password" "origin_verify" \{\s*\n\s*length\s*=\s*48\s*\n\s*special = false/)
  assert.match(lockdown, /com\.amazonaws\.global\.cloudfront\.origin-facing/)
  assert.match(lockdown, /zone_id\s*=\s*aws_route53_zone\.seaandshore\.zone_id/)
  assert.match(main, /security_groups = \[aws_security_group\.alb\.id, aws_security_group\.alb_cloudfront\.id\]/)
})

test('stage B: CloudFront uses the HTTPS origin with the secret header, and no log can print it', async () => {
  const edge = await read('../../infra/aws/app/edge.tf')
  const recovery = await read('./edge-recovery.sh')
  const audit = await read('./audit-edge-state.sh')
  const checker = await read('./check-edge-plan.py')
  assert.match(edge, /domain_name = var\.origin_tls_hostname/)
  assert.match(edge, /name\s*=\s*"X-Origin-Verify"\s*\n\s*value = random_password\.origin_verify\.result/)
  assert.match(edge, /origin_protocol_policy = "https-only"/)
  assert.doesNotMatch(edge, /http-only|data "aws_lb" "edge_origin"/)
  assert.match(checker, /'origin_protocol_policy':'https-only'/)
  assert.match(checker, /EDGE_ORIGIN_VERIFY_FILE/)
  // The edge runner reads the secret into a private file, passes it by file, and redacts it from
  // the plan summary it prints; the post-apply check compares it without printing it.
  assert.match(recovery, /ORIGIN="origin-staging\.seaandshore\.in"/)
  assert.match(recovery, /export EDGE_ORIGIN_VERIFY_FILE="\$RECOVERY_DIR\/origin-verify"/)
  assert.match(recovery, /if \.name == "X-Origin-Verify" then "\[redacted\]" else \.value end/)
  assert.match(recovery, /--rawfile verify "\$RECOVERY_DIR\/origin-verify"/)
  assert.doesNotMatch(recovery, /cat "\$RECOVERY_DIR\/origin-verify"|echo[^\n]*origin-verify/)
  assert.match(recovery, /\.desiredCount == \$before\[0\]\.services\[0\]\.desiredCount and \.runningCount == \.desiredCount/)
  assert.doesNotMatch(recovery, /\.desiredCount == 1 and/)
  assert.match(audit, /CustomHeaderNames:\[\.CustomHeaders\.Items\[\]\?\.HeaderName\]/)
  assert.doesNotMatch(audit, /Origins:\.DistributionConfig\.Origins/)
})

test('stage C: the ALB answers only CloudFront, on 443', async () => {
  assert.match(main, /variable "allowed_ingress_cidrs" \{[\s\S]*?default\s*=\s*\[\]/)
  // An explicit empty list: zero dynamic blocks would leave the old inline rules in place.
  const albGroup = main.slice(main.indexOf('resource "aws_security_group" "alb" {'), main.indexOf('resource "aws_security_group" "ecs" {'))
  assert.match(albGroup, /\n\s*ingress = \[\]\n/)
  assert.doesNotMatch(albGroup, /dynamic "ingress"|cidr_blocks = var\.allowed_ingress_cidrs/)
  assert.doesNotMatch(main, /from_port\s*=\s*80/)
  assert.doesNotMatch(main, /resource "aws_lb_listener" "http_forward"/)
  assert.match(main, /depends_on = \[\s*\n\s*aws_lb_listener\.origin_https,/)
})
