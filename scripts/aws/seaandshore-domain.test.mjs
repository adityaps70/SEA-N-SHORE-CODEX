import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('seaandshore.in has a guarded two-stage release path that copies the legacy zone exactly', async () => {
  const tf = await read('../../infra/aws/app/seaandshore_domain.tf')
  const script = await read('./seaandshore-domain.sh')
  const workflow = await read('../../.github/workflows/aws-seaandshore-domain.yml')
  const action = (await read('./seaandshore-domain-action.txt')).trim()

  assert.ok(['plan', 'apply-once'].includes(action), `Unexpected seaandshore domain action: ${action}`)

  // Stage switch defaults to off; stage B is a deliberate repository change.
  assert.match(tf, /variable "seaandshore_redirect_live" \{[\s\S]*?default\s*=\s*(true|false)/)

  // Every record observed on the old name servers (2026-09-29) is present with the same TTL/values.
  assert.match(tf, /seaandshore_legacy_ip\s*=\s*"216\.10\.253\.21"/)
  assert.match(tf, /seaandshore_legacy_ttl\s*=\s*21600/)
  assert.match(tf, /"seaandshore_mx"[\s\S]*?records = \["1 smtp\.google\.com\."\]/)
  assert.match(tf, /"seaandshore_txt"[\s\S]*?"v=spf1 include:_spf\.google\.com ~all",\s*"google-site-verification=bg3lvB1nw4ODMIG7ExwNWTI5t8zW8AkR0DexUVLD1H4",/)
  for (const record of ['seaandshore_mail_a', 'seaandshore_webmail_a', 'seaandshore_ns1_a', 'seaandshore_ns2_a']) {
    assert.match(tf, new RegExp(`"${record}"[\\s\\S]*?type\\s*=\\s*"A"[\\s\\S]*?records = \\[local\\.seaandshore_legacy_ip\\]`))
  }
  assert.match(tf, /"seaandshore_ftp_cname"[\s\S]*?type\s*=\s*"CNAME"[\s\S]*?records = \[local\.seaandshore_domain\]/)
  assert.match(tf, /"seaandshore_acme_challenge_txt"[\s\S]*?records = \["coLRxfhIhhYaWhwZE_BBLN8nw1jEVxQpbXTphW4vU1A"\]/)
  assert.match(tf, /"seaandshore_apex_a"[\s\S]*?records = var\.seaandshore_redirect_live \? null : \[local\.seaandshore_legacy_ip\]/)
  assert.match(tf, /"seaandshore_www"[\s\S]*?type\s*=\s*var\.seaandshore_redirect_live \? "A" : "CNAME"/)
  assert.match(tf, /"seaandshore_www_aaaa"[\s\S]*?depends_on = \[aws_route53_record\.seaandshore_www\]/)

  // Certificate + redirect-only distribution; no origin traffic beyond what CloudFront requires.
  assert.match(tf, /aws_acm_certificate" "seaandshore_edge"[\s\S]*?provider\s*=\s*aws\.us_east_1[\s\S]*?validation_method\s*=\s*"DNS"/)
  assert.match(tf, /aws_cloudfront_function" "legacy_domain_redirect"[\s\S]*?runtime = "cloudfront-js-2\.0"/)
  assert.match(tf, /legacy-domain-redirect\.js\.tftpl/)
  assert.match(tf, /aws_cloudfront_distribution" "seaandshore_redirect"/)
  assert.match(tf, /viewer_protocol_policy\s*=\s*"allow-all"/)
  assert.match(tf, /aws_acm_certificate\.seaandshore_edge\.status == "ISSUED"/)
  assert.doesNotMatch(tf, /web_acl_id/)

  // The guard: exact legacy snapshot, bounded stage transitions, saved-plan apply only.
  assert.match(script, /SEAANDSHORE_DOMAIN_EXPECTED_SHA/)
  assert.match(script, /plan\|apply-once/)
  assert.match(script, /LEGACY_IP="216\.10\.253\.21"/)
  assert.match(script, /Untracked public Route53 zone already exists/)
  for (const target of [
    'aws_route53_zone.seaandshore', 'aws_route53_record.seaandshore_mx', 'aws_route53_record.seaandshore_txt',
    'aws_route53_record.seaandshore_apex_a', 'aws_route53_record.seaandshore_www',
    'aws_acm_certificate.seaandshore_edge', 'aws_cloudfront_function.legacy_domain_redirect',
    'aws_cloudfront_distribution.seaandshore_redirect',
  ]) {
    assert.ok(script.includes(`  ${target}\n`), `missing target ${target}`)
  }
  assert.match(script, /differs from the legacy snapshot/)
  assert.ok(script.includes("actions in (['update'],['delete','create'],['create','delete'])"))
  assert.match(script, /unexpected seaandshore change/)
  assert.match(script, /DNS_PARITY_VERIFIED=true/)
  assert.match(script, /ROUTE53_NAME_SERVER=/)
  assert.match(script, /ACM_CERTIFICATE_STATUS=/)
  assert.match(script, /REDIRECT_PROBE=/)
  assert.match(script, /SEAANDSHORE_REDIRECT_LIVE_VERIFIED=true/)
  assert.match(script, /SEAANDSHORE_DOMAIN_PLAN_VERIFIED=true/)
  assert.match(script, /SEAANDSHORE_DOMAIN_PLAN_ONLY_NO_APPLY/)
  assert.match(script, /SEAANDSHORE_DOMAIN_APPLY_VERIFIED=true/)
  assert.doesNotMatch(script, /change-resource-record-sets/)
  assert.doesNotMatch(script, /update-distribution/)
  assert.doesNotMatch(script, /seanshore_domain\.tf/)

  assert.match(workflow, /name: AWS seaandshore\.in Legacy Domain/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Guard legacy domain release against a moved branch/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /SEAANDSHORE_DOMAIN_EXPECTED_SHA/)
  assert.match(workflow, /bash scripts\/aws\/seaandshore-domain\.sh/)
  assert.match(workflow, /apply-once is allowed only from an exact branch push/)
})
