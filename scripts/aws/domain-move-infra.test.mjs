import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { guardAction } from './guard-value.mjs'

// Domain move (seanshore.net), Phase 1 infrastructure (owner-approved 18 Nov): import the console-made resources
// unchanged, then create only the new certificates, the seanshore.net email DNS and the private edge-logs bucket.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const script = read('./domain-move-infra.sh')
const imports = read('./domain-move-imports.tf.tpl')
const workflow = read('../../.github/workflows/aws-domain-move-infra.yml')
const tf = read('../../infra/aws/app/domain-move.tf')
const checker = new URL('./check-domain-move-plan.py', import.meta.url).pathname

const ZONES = ['seaandshore.si', 'seanshore.nl', 'seanshore.ph', 'seanshore.si']
const HOSTS = ZONES.flatMap((zone) => [zone, `www.${zone}`])
const VALIDATION = [
  '_7174cb4244bac86afafb95ddeaabf6db.seanshore.ph', '_87fc76e948b4883bc1974376f292aca6.www.seanshore.ph',
  '_50d2b904c17f8fb011ecc4ec8ce4b283.seanshore.nl', '_3f9bb0ee552791619aae8c75f274c910.www.seanshore.nl',
  '_593f2bd7eb81c6d456d1edfd572e40e3.seanshore.si', '_fc37b62195dcf025867ce7cf1c6f52b5.www.seanshore.si',
  '_87316a6386dd4c23ab5534d20a0c00b7.seaandshore.si', '_b200d0fa6c54695a0cefbf3cb32f0009.www.seaandshore.si',
]
const IMPORTS = [
  'aws_route53_zone.seanshore_net',
  ...ZONES.map((z) => `aws_route53_zone.console["${z}"]`),
  'aws_acm_certificate.console_redirect', 'aws_cloudfront_function.console_redirect', 'aws_cloudfront_distribution.console_redirect',
  ...HOSTS.flatMap((h) => ['A', 'AAAA'].map((t) => `aws_route53_record.console_redirect_alias["${h} ${t}"]`)),
  ...VALIDATION.map((n) => `aws_route53_record.console_redirect_validation["${n}"]`),
  'aws_route53_record.seanshore_google_site_verification', 'aws_route53_record.seanshore_resend_dkim',
  'aws_route53_record.seanshore_resend_return_path["rsend"]', 'aws_route53_record.seanshore_resend_return_path["send"]',
]
const LEGACY_NAMES = ['seaandshore.in', 'www.seaandshore.in', ...HOSTS]

function run(args) {
  return spawnSync('python3', ['-I', checker, ...args], { encoding: 'utf8' })
}
function planFile(changes) {
  const dir = mkdtempSync(join(tmpdir(), 'domain-move-plan-'))
  const path = join(dir, 'plan.json')
  writeFileSync(path, JSON.stringify({ resource_changes: changes }))
  return path
}
const noop = (address, extra = {}) => ({ address, mode: 'managed', change: { actions: ['no-op'], after: {} , ...extra } })
const importing = (address) => noop(address, { importing: { id: 'x' } })
const importPlan = () => [...IMPORTS.map(importing), noop('aws_route53_zone.seanshore')]

function createAfter() {
  return {
    'aws_route53_record.seanshore_net_resend_dkim': { name: 'resend._domainkey.mail.seanshore.net', type: 'TXT', records: ['p=MIGf'] },
    'aws_route53_record.seanshore_net_resend_return_path["rsend"]': { name: 'rsend.mail.seanshore.net', type: 'CNAME', records: ['rsend-apne1.forge.rmta.net'] },
    'aws_route53_record.seanshore_net_resend_return_path["send"]': { name: 'send.mail.seanshore.net', type: 'CNAME', records: ['send.forge.rmta.net'] },
    'aws_route53_record.seanshore_net_dmarc': { name: '_dmarc.seanshore.net', type: 'TXT', records: ['v=DMARC1; p=quarantine; adkim=r; aspf=r'] },
    'aws_acm_certificate.site_edge': { domain_name: 'seanshore.in', subject_alternative_names: ['www.seanshore.in', 'seanshore.net', 'www.seanshore.net'], validation_method: 'DNS' },
    'aws_route53_record.site_edge_validation["seanshore.net"]': {},
    'aws_route53_record.site_edge_validation["www.seanshore.net"]': {},
    'aws_acm_certificate_validation.site_edge': {},
    'aws_acm_certificate.legacy_redirect': { domain_name: 'seaandshore.in', subject_alternative_names: LEGACY_NAMES.slice(1), validation_method: 'DNS' },
    'aws_acm_certificate_validation.legacy_redirect': {},
    'aws_s3_bucket.edge_logs': { bucket: 'sea-n-shore-staging-310356785722-edge-logs' },
    'aws_s3_bucket_public_access_block.edge_logs': { block_public_acls: true, block_public_policy: true, ignore_public_acls: true, restrict_public_buckets: true },
    'aws_s3_bucket_ownership_controls.edge_logs': { rule: [{ object_ownership: 'BucketOwnerEnforced' }] },
    'aws_s3_bucket_server_side_encryption_configuration.edge_logs': { rule: [{ apply_server_side_encryption_by_default: [{ sse_algorithm: 'AES256' }] }] },
    'aws_s3_bucket_lifecycle_configuration.edge_logs': { rule: [{ status: 'Enabled', expiration: [{ days: 30 }] }] },
    'aws_s3_bucket_policy.edge_logs': {},
    'aws_cloudwatch_log_delivery_source.edge["app"]': { log_type: 'ACCESS_LOGS', resource_arn: 'arn:aws:cloudfront::310356785722:distribution/EF1K45UVP11XZ' },
    'aws_cloudwatch_log_delivery_source.edge["redirect"]': { log_type: 'ACCESS_LOGS', resource_arn: 'arn:aws:cloudfront::310356785722:distribution/EK1KQZWPWQZNQ' },
    'aws_cloudwatch_log_delivery_destination.edge_logs': {},
    'aws_cloudwatch_log_delivery.edge["app"]': {},
    'aws_cloudwatch_log_delivery.edge["redirect"]': {},
  }
}
function createPlan(overrides = {}, extra = []) {
  const after = { ...createAfter(), ...overrides }
  return [
    ...Object.entries(after).filter(([, value]) => value !== null).map(([address, value]) => ({ address, mode: 'managed', change: { actions: ['create'], after: value } })),
    noop('aws_route53_zone.seanshore_net'), noop('aws_acm_certificate.seanshore_edge'),
    ...extra,
  ]
}
const createArgs = (changes) => ['create', planFile(changes), 'EF1K45UVP11XZ', 'EK1KQZWPWQZNQ']

test('the guard reads plan, import-once or create-once with the exact SHA it arms', () => {
  const action = guardAction(read('./domain-move-infra-action.txt'))
  assert.ok(['plan', 'import-once', 'create-once'].includes(action), `Unexpected domain move infra action: ${action}`)
})

test('import: exactly the console-made resources, every one a no-op', () => {
  const ok = run(['import', planFile(importPlan())])
  assert.equal(ok.status, 0, ok.stdout)
  assert.match(ok.stdout, /^DOMAIN_MOVE_PLAN=IMPORT imports=36$/m)
  const done = run(['import', planFile(IMPORTS.map((a) => noop(a)))])
  assert.equal(done.status, 0, done.stdout)
  assert.match(done.stdout, /^DOMAIN_MOVE_PLAN=NO_CHANGES$/m)

  const refused = (changes, why) => {
    const result = run(['import', planFile(changes)])
    assert.notEqual(result.status, 0, why)
    assert.match(result.stdout, /DOMAIN_MOVE_PLAN_REFUSED/, why)
  }
  refused(importPlan().map((c) => c.address === 'aws_cloudfront_distribution.console_redirect' ? { ...c, change: { ...c.change, actions: ['update'] } } : c), 'an import that would change the distribution')
  refused(importPlan().map((c) => c.address === 'aws_acm_certificate.console_redirect' ? { ...c, change: { ...c.change, actions: ['delete', 'create'] } } : c), 'a replaced certificate')
  refused([...importPlan(), { address: 'aws_route53_zone.extra', mode: 'managed', change: { actions: ['create'] } }], 'a create')
  refused(importPlan().slice(1), 'a missing import')
  refused([...importPlan(), importing('aws_route53_record.other')], 'an extra import')
  refused([noop('aws_route53_zone.seanshore')], 'nothing imported and nothing in state')
})

test('create: exactly the approved new resources with the approved settings, nothing else', () => {
  const ok = run(createArgs(createPlan()))
  assert.equal(ok.status, 0, ok.stdout)
  assert.match(ok.stdout, /^DOMAIN_MOVE_PLAN=CREATE creates=21$/m)
  const refused = (changes, why) => {
    const result = run(createArgs(changes))
    assert.notEqual(result.status, 0, why)
    assert.match(result.stdout, /DOMAIN_MOVE_PLAN_REFUSED/, why)
  }
  refused(createPlan({ 'aws_acm_certificate.site_edge': { domain_name: 'seanshore.in', subject_alternative_names: ['www.seanshore.in', 'seanshore.net'], validation_method: 'DNS' } }), 'a certificate missing www.seanshore.net')
  refused(createPlan({ 'aws_acm_certificate.legacy_redirect': { domain_name: 'seaandshore.in', subject_alternative_names: LEGACY_NAMES.slice(1, 8), validation_method: 'DNS' } }), 'a redirect certificate missing names')
  refused(createPlan({ 'aws_route53_record.seanshore_net_dmarc': { name: '_dmarc.seanshore.net', records: ['v=DMARC1; p=none'] } }), 'a weaker DMARC')
  refused(createPlan({ 'aws_s3_bucket_public_access_block.edge_logs': { block_public_acls: true, block_public_policy: false, ignore_public_acls: true, restrict_public_buckets: true } }), 'a bucket that can be public')
  refused(createPlan({ 'aws_s3_bucket_lifecycle_configuration.edge_logs': { rule: [{ status: 'Enabled', expiration: [{ days: 90 }] }] } }), 'logs kept 90 days')
  refused(createPlan({ 'aws_s3_bucket_ownership_controls.edge_logs': { rule: [{ object_ownership: 'ObjectWriter' }] } }), 'ACLs enabled on the logs bucket')
  refused(createPlan({ 'aws_cloudwatch_log_delivery_source.edge["app"]': { log_type: 'ACCESS_LOGS', resource_arn: 'arn:aws:cloudfront::310356785722:distribution/EOTHER' } }), 'logs from another distribution')
  refused(createPlan({ 'aws_route53_record.seanshore_net_resend_return_path["send"]': { name: 'send.mail.seanshore.net', type: 'CNAME', records: ['elsewhere.example'] } }), 'a wrong return path')
  refused(createPlan({}, [{ address: 'aws_cloudfront_distribution.app', mode: 'managed', change: { actions: ['update'] } }]), 'a change to the main distribution')
  refused(createPlan({}, [importing('aws_route53_zone.other')]), 'an import in the create step')
  refused(createPlan({ 'aws_cloudwatch_log_delivery.edge["redirect"]': null }), 'a missing create')
  const done = run(createArgs([noop('aws_acm_certificate.site_edge'), ...Object.keys(createAfter()).map((a) => noop(a))]))
  assert.match(done.stdout, /^DOMAIN_MOVE_PLAN=NO_CHANGES$/m)
})

test('Terraform: imported resources are kept, the import blocks never live under infra/aws/app', () => {
  for (const name of readdirSync(new URL('../../infra/aws/app/', import.meta.url))) {
    if (name.endsWith('.tf')) assert.doesNotMatch(read(`../../infra/aws/app/${name}`), /^import \{/m, `${name} holds an import block`)
  }
  assert.match(script, /cp -- "\$IMPORTS_TEMPLATE" "\$APP_DIR\/zz_domain_move_imports\.tf"/)
  assert.match(script, /rm -f -- "\$APP_DIR\/zz_domain_move_imports\.tf"' EXIT/)
  // Every imported resource keeps prevent_destroy, and so do the two new certificates.
  for (const resource of ['aws_route53_zone" "seanshore_net', 'aws_route53_zone" "console', 'aws_acm_certificate" "console_redirect', 'aws_cloudfront_function" "console_redirect', 'aws_cloudfront_distribution" "console_redirect', 'aws_acm_certificate" "site_edge', 'aws_acm_certificate" "legacy_redirect']) {
    const block = tf.slice(tf.indexOf(`resource "${resource}"`))
    assert.match(block.slice(0, block.indexOf('\n}\n')), /prevent_destroy\s+= true/, resource)
  }
  // The import ids are exactly the Phase 0 report's.
  assert.match(imports, /id = "E2MCZ79G101LLD"/)
  assert.match(tf, /seanshore_net_zone_id = "Z09758912UIE2T2PK09U"/)
  assert.match(imports, /arn:aws:acm:us-east-1:310356785722:certificate\/4a7934fb-4dcd-4247-82ed-cd0c6203d4af/)
  // The console function is imported byte for byte (Phase 2 replaces it); the redirect certificate holds ten names.
  assert.equal(read('../../infra/aws/app/cloudfront/console-redirect-domains.js.tftpl'), "function handler(event) {\n  return {\n    statusCode: 301,\n    statusDescription: 'Moved Permanently',\n    headers: { location: { value: 'https://seanshore.in' + event.request.uri } }\n  };\n}\n")
  assert.match(tf, /legacy_redirect_names = concat\(\["seaandshore\.in", "www\.seaandshore\.in"\], local\.console_redirect_hosts\)/)
  // No receiving MX for seanshore.net (mail.seanshore.in has none).
  assert.doesNotMatch(tf, /type\s+= "MX"/)
  // The main distribution is not touched in this step (other edge runs would see the change).
  assert.doesNotMatch(tf, /aws_cloudfront_distribution\.app\b/)
})

test('the runner: account and branch checks, host lock, one classified apply, verified afterwards', () => {
  assert.match(script, /source scripts\/aws\/bootstrap-terraform-lock\.sh/)
  assert.ok(script.indexOf('get-caller-identity') < script.indexOf('source scripts/aws/bootstrap-terraform-lock.sh'))
  assert.equal((script.match(/terraform -chdir="\$APP_DIR" apply /g) ?? []).length, 1)
  assert.match(script, /apply -input=false -no-color -lock-timeout=60s "\$WORK_DIR\/before\.tfplan"/)
  assert.ok(script.indexOf('if [[ "$ACTION" == plan ]]') < script.indexOf('apply -input=false'))
  assert.ok(script.indexOf('branch-head.sh refs/heads/feat/aws-native-phase-0-1') < script.indexOf('apply -input=false'))
  assert.match(script, /import-once\) \[\[ "\$STEP" == import \]\]/)
  assert.match(script, /create-once\) \[\[ "\$STEP" == create \]\]/)
  assert.match(script, /\[\[ "\$APP_DISTRIBUTION_ID" == EF1K45UVP11XZ && "\$REDIRECT_DISTRIBUTION_ID" == EK1KQZWPWQZNQ \]\]/)
  assert.match(script, /\[\[ "\$status" == ISSUED \]\]/)
  // The edge-logs bucket is never listed or read (logs hold visitor IP addresses).
  assert.doesNotMatch(script, /list-objects|get-object[^\n]*edge-logs|s3 (ls|cp)/)
  const calls = [...script.matchAll(/\baws ([a-z0-9]+) ([a-z-]+)/g)].map((m) => `${m[1]} ${m[2]}`)
  for (const call of calls) assert.match(call, /^(sts get-caller-identity|s3api (get-object|get-public-access-block|get-bucket-lifecycle-configuration)|acm describe-certificate|logs describe-deliveries)$/, call)
})

test('the workflow runs the guarded host runner from the exact armed commit, with room for ACM validation', () => {
  assert.match(workflow, /^name: AWS Domain Move Infra$/m)
  assert.match(workflow, /GUARD_FILE: scripts\/aws\/domain-move-infra-action\.txt/)
  assert.match(workflow, /export DOMAIN_MOVE_INFRA_EXPECTED_SHA=\{sha\}\n\s+bash scripts\/aws\/domain-move-infra\.sh/)
  assert.match(workflow, /"executionTimeout": \["3600"\]/)
  assert.match(workflow, /plan\|discover\) echo "approval=false"/)
  assert.ok(existsSync(new URL('../../infra/aws/app/domain-move.tf', import.meta.url)))
})
