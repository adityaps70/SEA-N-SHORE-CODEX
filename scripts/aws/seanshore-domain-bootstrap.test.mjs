import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('seanshore.in AWS bootstrap has a guarded create-only release path', async () => {
  const tfUrl = new URL('../../infra/aws/app/seanshore_domain.tf', import.meta.url)
  const scriptUrl = new URL('./seanshore-domain-bootstrap.sh', import.meta.url)
  const actionUrl = new URL('./seanshore-domain-bootstrap-action.txt', import.meta.url)
  const workflowUrl = new URL('../../.github/workflows/aws-seanshore-domain-bootstrap.yml', import.meta.url)

  assert.equal(existsSync(tfUrl), true)
  assert.equal(existsSync(scriptUrl), true)
  assert.equal(existsSync(actionUrl), true)
  assert.equal(existsSync(workflowUrl), true)
  assert.ok(['plan', 'apply-once'].includes((await readFile(actionUrl, 'utf8')).trim()))

  const tf = await readFile(tfUrl, 'utf8')
  assert.match(tf, /aws_route53_zone" "seanshore"/)
  assert.match(tf, /name\s*=\s*"seanshore\.in"/)
  assert.match(tf, /aws_acm_certificate" "seanshore_edge"/)
  assert.match(tf, /provider\s*=\s*aws\.us_east_1/)
  assert.match(tf, /domain_name\s*=\s*"seanshore\.in"/)
  assert.match(tf, /subject_alternative_names\s*=\s*\["www\.seanshore\.in"\]/)
  assert.match(tf, /validation_method\s*=\s*"DNS"/)
  assert.match(tf, /aws_route53_record" "seanshore_legacy_apex"/)
  assert.match(tf, /aws_route53_record" "seanshore_legacy_www"/)
  assert.match(tf, /records\s*=\s*\["162\.215\.226\.7"\]/)
  assert.match(tf, /aws_route53_record" "seanshore_edge_validation"/)
  assert.match(tf, /domain_validation_options/)
  assert.doesNotMatch(tf, /aws_cloudfront_distribution/)

  const script = await readFile(scriptUrl, 'utf8')
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /EXPECTED_DOMAIN="seanshore\.in"/)
  assert.match(script, /SEANSHORE_DOMAIN_BOOTSTRAP_EXPECTED_SHA/)
  assert.match(script, /plan\|apply-once/)
  assert.match(script, /-target=aws_route53_zone\.seanshore/)
  assert.match(script, /-target=aws_acm_certificate\.seanshore_edge/)
  assert.match(script, /-target=aws_route53_record\.seanshore_legacy_apex/)
  assert.match(script, /-target=aws_route53_record\.seanshore_legacy_www/)
  assert.match(script, /-target=aws_route53_record\.seanshore_edge_validation/)
  assert.match(script, /SEANSHORE_DOMAIN_BOOTSTRAP_PLAN_VERIFIED=true/)
  assert.match(script, /SEANSHORE_DOMAIN_BOOTSTRAP_APPLY_VERIFIED=true/)
  assert.match(script, /ROUTE53_NAME_SERVER=/)
  assert.match(script, /PUBLIC_NAME_SERVER=/)
  assert.match(script, /SEANSHORE_DOMAIN_LIVE_ZONE_ID=/)
  assert.ok(
    script.indexOf('SEANSHORE_DOMAIN_LIVE_ZONE_ID=') <
      script.indexOf('SEANSHORE_DOMAIN_BOOTSTRAP_PLAN_ONLY_NO_APPLY'),
  )
  assert.match(script, /ACM_VALIDATION_RECORD=/)
  assert.doesNotMatch(script, /change-resource-record-sets/)
  assert.doesNotMatch(script, /update-distribution/)

  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /name: AWS seanshore\.in Domain Bootstrap/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Guard domain bootstrap against a moved branch/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /SEANSHORE_DOMAIN_BOOTSTRAP_EXPECTED_SHA/)
  assert.match(workflow, /bash scripts\/aws\/seanshore-domain-bootstrap\.sh/)
})
