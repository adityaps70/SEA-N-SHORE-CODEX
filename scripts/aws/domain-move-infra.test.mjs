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
    // As the AWS provider 6.62.0 plans it (run 44904143142): the domain name is in subject_alternative_names too.
    'aws_acm_certificate.site_edge': { domain_name: 'seanshore.in', subject_alternative_names: ['seanshore.in', 'seanshore.net', 'www.seanshore.in', 'www.seanshore.net'], validation_method: 'DNS' },
    'aws_route53_record.site_edge_validation["seanshore.net"]': {},
    'aws_route53_record.site_edge_validation["www.seanshore.net"]': {},
    'aws_acm_certificate_validation.site_edge': {},
    'aws_acm_certificate.legacy_redirect': { domain_name: 'seaandshore.in', subject_alternative_names: [...LEGACY_NAMES].sort(), validation_method: 'DNS' },
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
// The viewer-request function update (owner, 21 Nov): x-sns-viewer-host from the real Host, never from the client.
const FUNCTION = 'aws_cloudfront_function.canonical_host_redirect'
const renderedFunction = () => read('../../infra/aws/app/cloudfront/canonical-host-redirect.js.tftpl')
  .replaceAll('${canonical_host}', 'seanshore.in').replaceAll('${alias_hosts}', '["seanshore.net"]').replaceAll('${edge_host}', 'd3prih0q6jofyr.cloudfront.net').replaceAll('${redirect_edge_host}', 'true')
const functionUpdate = (afterOverrides = {}, unknown = { etag: true, live_stage_etag: true }) => {
  const before = { name: 'sea-n-shore-staging-canonical-host-redirect', runtime: 'cloudfront-js-2.0', publish: true, comment: 'c', code: 'OLDCODE', etag: 'E1', live_stage_etag: 'E1' }
  const afterValue = { ...before, code: renderedFunction(), etag: null, live_stage_etag: null, ...afterOverrides }
  return { address: FUNCTION, mode: 'managed', change: { actions: ['update'], before, after: afterValue, after_unknown: unknown } }
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
  // Every change is named with its attribute names, never values (run 44507644027 showed only the first).
  const listed = run(['import', planFile(importPlan().map((c) => c.address === 'aws_cloudfront_function.console_redirect'
    ? { ...c, change: { ...c.change, actions: ['update'], before: { publish: null, code: 'SECRETCODE', name: 'f' }, after: { publish: true, code: 'SECRETCODE', name: 'f' } } }
    : c.address === 'aws_route53_zone.seanshore_net' ? { ...c, change: { ...c.change, actions: ['update'], before: { comment: 'a' }, after: { comment: 'b' } } } : c))])
  assert.notEqual(listed.status, 0)
  assert.match(listed.stdout, /^DOMAIN_MOVE_PLAN_DIFF address=aws_cloudfront_function\.console_redirect actions=update attributes=publish$/m)
  assert.match(listed.stdout, /^DOMAIN_MOVE_PLAN_DIFF address=aws_route53_zone\.seanshore_net actions=update attributes=comment$/m)
  assert.match(listed.stdout, /DOMAIN_MOVE_PLAN_REFUSED changes=2/)
  assert.doesNotMatch(listed.stdout, /SECRETCODE|"a"|"b"/)
  refused(importPlan().map((c) => c.address === 'aws_acm_certificate.console_redirect' ? { ...c, change: { ...c.change, actions: ['delete', 'create'] } } : c), 'a replaced certificate')
  refused([...importPlan(), { address: 'aws_route53_zone.extra', mode: 'managed', change: { actions: ['create'] } }], 'a create')
  refused(importPlan().slice(1), 'a missing import')
  refused([...importPlan(), importing('aws_route53_record.other')], 'an extra import')
  refused([noop('aws_route53_zone.seanshore')], 'nothing imported and nothing in state')
})

test('create: exactly the approved new resources with the approved settings, nothing else', () => {
  const ok = run(createArgs(createPlan()))
  assert.equal(ok.status, 0, ok.stdout)
  assert.match(ok.stdout, /^DOMAIN_MOVE_PLAN=CREATE creates=21 updates=0$/m)
  const withFunction = run(createArgs(createPlan({}, [functionUpdate()])))
  assert.equal(withFunction.status, 0, withFunction.stdout)
  assert.match(withFunction.stdout, /^DOMAIN_MOVE_PLAN=CREATE creates=21 updates=1$/m)
  assert.doesNotMatch(withFunction.stdout, /OLDCODE|x-sns-viewer-host/)
  const refused = (changes, why) => {
    const result = run(createArgs(changes))
    assert.notEqual(result.status, 0, why)
    assert.match(result.stdout, /DOMAIN_MOVE_PLAN_REFUSED/, why)
  }
  // Without the domain name in the list (older provider shape) the same names still pass.
  const plain = run(createArgs(createPlan({ 'aws_acm_certificate.site_edge': { domain_name: 'seanshore.in', subject_alternative_names: ['www.seanshore.in', 'seanshore.net', 'www.seanshore.net'], validation_method: 'DNS' } })))
  assert.equal(plain.status, 0, plain.stdout)
  refused(createPlan({ 'aws_acm_certificate.site_edge': { domain_name: 'seanshore.in', subject_alternative_names: ['seanshore.in', 'www.seanshore.in', 'seanshore.net'], validation_method: 'DNS' } }), 'a certificate missing www.seanshore.net')
  refused(createPlan({ 'aws_acm_certificate.site_edge': { domain_name: 'seanshore.in', subject_alternative_names: ['seanshore.in', 'www.seanshore.in', 'seanshore.net', 'www.seanshore.net', 'evil.example'], validation_method: 'DNS' } }), 'a certificate with an extra name')
  refused(createPlan({ 'aws_acm_certificate.site_edge': { domain_name: 'seanshore.net', subject_alternative_names: ['seanshore.in', 'www.seanshore.in', 'seanshore.net', 'www.seanshore.net'], validation_method: 'DNS' } }), 'a certificate whose main name is not seanshore.in')
  refused(createPlan({ 'aws_acm_certificate.legacy_redirect': { domain_name: 'seaandshore.in', subject_alternative_names: LEGACY_NAMES.slice(0, 8), validation_method: 'DNS' } }), 'a redirect certificate missing names')
  refused(createPlan({ 'aws_acm_certificate.legacy_redirect': { domain_name: 'www.seaandshore.in', subject_alternative_names: [...LEGACY_NAMES].sort(), validation_method: 'DNS' } }), 'a redirect certificate whose main name is not seaandshore.in')
  refused(createPlan({ 'aws_route53_record.seanshore_net_dmarc': { name: '_dmarc.seanshore.net', records: ['v=DMARC1; p=none'] } }), 'a weaker DMARC')
  refused(createPlan({ 'aws_s3_bucket_public_access_block.edge_logs': { block_public_acls: true, block_public_policy: false, ignore_public_acls: true, restrict_public_buckets: true } }), 'a bucket that can be public')
  refused(createPlan({ 'aws_s3_bucket_lifecycle_configuration.edge_logs': { rule: [{ status: 'Enabled', expiration: [{ days: 90 }] }] } }), 'logs kept 90 days')
  refused(createPlan({ 'aws_s3_bucket_ownership_controls.edge_logs': { rule: [{ object_ownership: 'ObjectWriter' }] } }), 'ACLs enabled on the logs bucket')
  refused(createPlan({ 'aws_cloudwatch_log_delivery_source.edge["app"]': { log_type: 'ACCESS_LOGS', resource_arn: 'arn:aws:cloudfront::310356785722:distribution/EOTHER' } }), 'logs from another distribution')
  refused(createPlan({ 'aws_route53_record.seanshore_net_resend_return_path["send"]': { name: 'send.mail.seanshore.net', type: 'CNAME', records: ['elsewhere.example'] } }), 'a wrong return path')
  refused(createPlan({}, [{ address: 'aws_cloudfront_distribution.app', mode: 'managed', change: { actions: ['update'] } }]), 'a change to the main distribution')
  refused(createPlan({}, [importing('aws_route53_zone.other')]), 'an import in the create step')
  refused(createPlan({ 'aws_cloudwatch_log_delivery.edge["redirect"]': null }), 'a missing create')
  refused(createPlan({}, [functionUpdate({ code: renderedFunction().replace("'x-sns-viewer-host'", "'x-other'") })]), 'function code that is not the template')
  refused(createPlan({}, [functionUpdate({ code: renderedFunction() + '\nhandler = function (e) { return e.request }' })]), 'function code with more appended')
  refused(createPlan({}, [functionUpdate({ comment: 'changed' })]), 'a function update beyond its code')
  const withStatus = run(createArgs(createPlan({}, [functionUpdate({}, { etag: true, live_stage_etag: true, status: true })])))
  assert.equal(withStatus.status, 0, withStatus.stdout)
  refused(createPlan({}, [functionUpdate({ publish: false })]), 'an unpublished function')
  refused(createPlan({}, [{ ...functionUpdate(), change: { ...functionUpdate().change, actions: ['delete', 'create'] } }]), 'a replaced function')
  refused(createPlan({}, [{ ...functionUpdate(), address: 'aws_cloudfront_function.legacy_domain_redirect' }]), 'another function')
  const done = run(createArgs([noop('aws_acm_certificate.site_edge'), ...Object.keys(createAfter()).map((a) => noop(a))]))
  assert.match(done.stdout, /^DOMAIN_MOVE_PLAN=NO_CHANGES$/m)
  // Everything created already, the function not yet: only the function update is left to apply.
  const functionOnly = run(createArgs([...Object.keys(createAfter()).map((a) => noop(a)), functionUpdate()]))
  assert.equal(functionOnly.status, 0, functionOnly.stdout)
  assert.match(functionOnly.stdout, /^DOMAIN_MOVE_PLAN=CREATE creates=0 updates=1$/m)
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
  // Run 44876340470: the console function imports with its code identical; publish and comment would plan a change.
  const consoleFunction = tf.slice(tf.indexOf('resource "aws_cloudfront_function" "console_redirect"'))
  assert.match(consoleFunction.slice(0, consoleFunction.indexOf('\n}\n')), /ignore_changes\s+= \[comment, publish\]/)
  assert.doesNotMatch(consoleFunction.slice(0, consoleFunction.indexOf('\n}\n')), /ignore_changes\s+= \[[^\]]*code/)
  // The console zones have no comment; the provider would plan "Managed by Terraform" on import.
  const consoleZone = tf.slice(tf.indexOf('resource "aws_route53_zone" "console"'))
  assert.match(consoleZone.slice(0, consoleZone.indexOf('\n}\n')), /ignore_changes\s+= \[comment\]/)
  // The import ids are exactly the Phase 0 report's.
  assert.match(imports, /id = "E2MCZ79G101LLD"/)
  assert.match(tf, /seanshore_net_zone_id = "Z09758912UIE2T2PK09U"/)
  assert.match(imports, /arn:aws:acm:us-east-1:310356785722:certificate\/4a7934fb-4dcd-4247-82ed-cd0c6203d4af/)
  // The console function is imported byte for byte (Phase 2 replaces it); the redirect certificate holds ten names.
  assert.equal(read('../../infra/aws/app/cloudfront/console-redirect-domains.js.tftpl'), "function handler(event) {\n  return {\n    statusCode: 301,\n    statusDescription: 'Moved Permanently',\n    headers: { location: { value: 'https://seanshore.in' + event.request.uri } }\n  };\n}\n")
  assert.match(tf, /legacy_redirect_names = concat\(\["seaandshore\.in", "www\.seaandshore\.in"\], local\.console_redirect_hosts\)/)
  // No receiving MX for seanshore.net (mail.seanshore.in has none).
  assert.doesNotMatch(tf, /type\s+= "MX"/)
  // domain-move.tf names the main distribution only as the alias target of the seanshore.net records (serve-once);
  // its own settings live in edge.tf.
  assert.equal((tf.match(/aws_cloudfront_distribution\.app\b/g) ?? []).length, 2)
  assert.match(tf, /resource "aws_route53_record" "site_net_alias" \{[^]*?name\s+= aws_cloudfront_distribution\.app\.domain_name\n\s+zone_id\s+= aws_cloudfront_distribution\.app\.hosted_zone_id/)
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
  // The create step updates the main distribution's viewer function (never the distribution itself) and then checks
  // live, after create-once only, that a faked x-sns-viewer-host still lands on https://seanshore.in.
  assert.match(script, /CREATE_TARGETS=\([^)]*"aws_cloudfront_function\.canonical_host_redirect"\n\)/)
  const createTargets = script.slice(script.indexOf('CREATE_TARGETS=('), script.indexOf('\n)\n', script.indexOf('CREATE_TARGETS=(')))
  assert.doesNotMatch(createTargets, /aws_cloudfront_distribution\.app/)
  assert.doesNotMatch(script, /-target=aws_cloudfront_distribution\.app/)
  const live = script.slice(script.indexOf('if [[ "$ACTION" == create-once ]]; then\n  viewer_host_location()'))
  assert.ok(live.length < script.length, 'the live check runs only after create-once')
  assert.match(live, /viewer_host_location -H 'x-sns-viewer-host: seanshore\.net'\)" == "https:\/\/seanshore\.in\/auth\/sign-in"/)
  assert.match(live, /https:\/\/seanshore\.in\/auth\/session-ended\?viewer_host_check=/)
  assert.match(live, /\[\[ "\$FAKED_OK" == true && "\$PLAIN_OK" == true && "\$WWW_OK" == true \]\]/)
  assert.ok(script.indexOf('viewer_host_location()') > script.indexOf('apply -input=false'))
  // Run 44479432280: a refused plan or a Terraform error must say why, not stop silently.
  assert.match(script, /CLASSIFICATION="\$\(classify "\$WORK_DIR\/before\.json"\)" \|\| CLASSIFY_STATUS=\$\?\necho "\$CLASSIFICATION"/)
  assert.match(script, /terraform_errors "terraform plan \(\$1\)" "\$WORK_DIR\/\$1\.log"/)
  assert.match(script, /terraform_errors "terraform apply" "\$WORK_DIR\/apply\.log"/)
  assert.match(script, /grep -E -A12 '\^\(│ \)\?Error' "\$2"/)
  // The edge-logs bucket is never listed or read (logs hold visitor IP addresses).
  assert.doesNotMatch(script, /list-objects|get-object[^\n]*edge-logs|s3 (ls|cp)/)
  const calls = [...script.matchAll(/\baws ([a-z0-9]+) ([a-z-]+)/g)].map((m) => `${m[1]} ${m[2]}`)
  for (const call of calls) assert.match(call, /^(sts get-caller-identity|s3api (get-object|get-public-access-block|get-bucket-lifecycle-configuration)|acm describe-certificate|logs describe-deliveries|route53 list-resource-record-sets)$/, call)
})

test('the workflow runs the guarded host runner from the exact armed commit, with room for ACM validation', () => {
  assert.match(workflow, /^name: AWS Domain Move Infra$/m)
  assert.match(workflow, /GUARD_FILE: scripts\/aws\/domain-move-infra-action\.txt/)
  assert.match(workflow, /export DOMAIN_MOVE_INFRA_EXPECTED_SHA=\{sha\}\n\s+bash scripts\/aws\/domain-move-infra\.sh/)
  assert.match(workflow, /"executionTimeout": \["3600"\]/)
  // A change to the viewer function the create step updates re-runs this plan.
  for (const path of ['infra/aws/app/cloudfront/canonical-host-redirect.js.tftpl', 'infra/aws/app/edge.tf']) {
    assert.match(workflow, new RegExp(`^      - ${path.replaceAll('.', '\\.')}$`, 'm'), path)
    assert.match(workflow, new RegExp(`RUNNER_FILES: "[^"]*${path.replaceAll('.', '\\.')}[^"]*"`), path)
  }
  assert.match(workflow, /plan\|discover\) echo "approval=false"/)
  assert.ok(existsSync(new URL('../../infra/aws/app/domain-move.tf', import.meta.url)))
})

// serve-once (Phase 1): seanshore.net next to seanshore.in on the main distribution, nothing else.
const SITE_EDGE_ARN = 'arn:aws:acm:us-east-1:310356785722:certificate/11111111-2222-3333-4444-555555555555'
const OLD_EDGE_ARN = 'arn:aws:acm:us-east-1:310356785722:certificate/00000000-2222-3333-4444-555555555555'
const ORIGINS = ['https://seanshore.in', 'https://seanshore.net', 'https://d3prih0q6jofyr.cloudfront.net']
const OLD_ORIGINS = ['https://seanshore.in', 'https://d3prih0q6jofyr.cloudfront.net']
const NET_RECORDS = ['seanshore.net', 'www.seanshore.net'].flatMap((host) => ['A', 'AAAA'].map((kind) => [host, kind]))
const cert = (arn) => [{ acm_certificate_arn: arn, ssl_support_method: 'sni-only', minimum_protocol_version: 'TLSv1.2_2021', cloudfront_default_certificate: false }]
const pagesKey = (headers) => [{ cookies_config: [{ cookie_behavior: 'whitelist' }], headers_config: [{ header_behavior: 'whitelist', headers: [{ items: headers }] }] }]
const update = (address, before, afterValue, unknown = {}) => ({ address, mode: 'managed', change: { actions: ['update'], before, after: afterValue, after_unknown: unknown } })
function servePlan(overrides = {}) {
  const pick = (key, value) => (key in overrides ? overrides[key] : value)
  const env = (origins) => [{ variables: { REALTIME_TICKET_AUDIENCE: 'sea-n-shore', REALTIME_TICKET_SECRET_ARN: 'arn:secret', REALTIME_ALLOWED_ORIGINS: origins.join(',') } }]
  const changes = [
    update('aws_cloudfront_distribution.app',
      { aliases: ['seanshore.in', 'www.seanshore.in'], viewer_certificate: cert(OLD_EDGE_ARN), web_acl_id: 'acl', origin: [{ id: 'alb' }] },
      pick('distribution', { aliases: ['seanshore.in', 'www.seanshore.in', 'seanshore.net', 'www.seanshore.net'], viewer_certificate: cert(SITE_EDGE_ARN), web_acl_id: 'acl', origin: [{ id: 'alb' }] }),
      { etag: true, last_modified_time: true }),
    functionUpdate(),
    update('aws_cloudfront_cache_policy.public_pages',
      { name: 'pages', parameters_in_cache_key_and_forwarded_to_origin: pagesKey(['rsc', 'next-router-prefetch', 'next-router-state-tree', 'next-router-segment-prefetch']) },
      { name: 'pages', parameters_in_cache_key_and_forwarded_to_origin: pagesKey(pick('pageHeaders', ['rsc', 'next-router-prefetch', 'next-router-state-tree', 'next-router-segment-prefetch', 'x-sns-viewer-host'])) },
      { etag: true }),
    update('aws_cognito_user_pool_client.web',
      { name: 'web', callback_urls: OLD_ORIGINS.map((o) => `${o}/auth/google/callback`), logout_urls: OLD_ORIGINS },
      pick('client', { name: 'web', callback_urls: ORIGINS.map((o) => `${o}/auth/google/callback`), logout_urls: ORIGINS })),
    update('aws_s3_bucket_cors_configuration.media',
      { bucket: 'media', cors_rule: [{ allowed_methods: ['PUT'], allowed_headers: ['Content-Type'], allowed_origins: OLD_ORIGINS }] },
      { bucket: 'media', cors_rule: [{ allowed_methods: ['PUT'], allowed_headers: ['Content-Type'], allowed_origins: pick('corsOrigins', ORIGINS) }] }),
    update('aws_lambda_function.realtime_authorizer',
      { function_name: 'authorizer', environment: env(OLD_ORIGINS) },
      { function_name: 'authorizer', environment: pick('authorizerEnv', env(ORIGINS)) },
      { last_modified: true, qualified_arn: true, version: true }),
    ...NET_RECORDS.map(([host, kind]) => ({ address: `aws_route53_record.site_net_alias["${host} ${kind}"]`, mode: 'managed', change: { actions: ['create'],
      after: pick(`record ${host} ${kind}`, { name: host, type: kind, zone_id: 'Z09758912UIE2T2PK09U', records: null, alias: [{ name: 'd3prih0q6jofyr.cloudfront.net', zone_id: 'Z2FDTNDATAQYW2', evaluate_target_health: false }] }) } })),
    noop('aws_acm_certificate.site_edge'), noop('aws_wafv2_web_acl.edge'),
  ]
  return [...changes, ...(overrides.extra ?? [])]
}
const serveArgs = (changes, arn = SITE_EDGE_ARN) => ['serve', planFile(changes), 'EF1K45UVP11XZ', arn]

test('serve: exactly the approved edge, DNS and origin changes, with the approved values', () => {
  const ok = run(serveArgs(servePlan()))
  assert.equal(ok.status, 0, ok.stdout)
  assert.match(ok.stdout, /^DOMAIN_MOVE_PLAN=SERVE updates=6 creates=4$/m)
  assert.doesNotMatch(ok.stdout, /arn:|seanshore\.net|cloudfront\.net/)
  const done = run(serveArgs([...servePlan().map((c) => noop(c.address))]))
  assert.equal(done.status, 0, done.stdout)
  assert.match(done.stdout, /^DOMAIN_MOVE_PLAN=NO_CHANGES$/m)

  const refused = (changes, why, arn) => {
    const result = run(serveArgs(changes, arn))
    assert.notEqual(result.status, 0, why)
    assert.match(result.stdout, /DOMAIN_MOVE_PLAN_REFUSED/, why)
  }
  const distribution = (fields) => ({ aliases: ['seanshore.in', 'www.seanshore.in', 'seanshore.net', 'www.seanshore.net'], viewer_certificate: cert(SITE_EDGE_ARN), web_acl_id: 'acl', origin: [{ id: 'alb' }], ...fields })
  refused(servePlan({ distribution: distribution({ aliases: ['seanshore.in', 'www.seanshore.in', 'seanshore.net'] }) }), 'www.seanshore.net missing')
  refused(servePlan({ distribution: distribution({ aliases: ['seanshore.in', 'www.seanshore.in', 'seanshore.net', 'www.seanshore.net', 'seaandshore.in'] }) }), 'an extra alias')
  refused(servePlan({ distribution: distribution({ viewer_certificate: cert(OLD_EDGE_ARN) }) }), 'the old certificate')
  refused(servePlan({ distribution: distribution({ web_acl_id: 'other' }) }), 'the WAF changed too')
  refused(servePlan({ distribution: distribution({ origin: [{ id: 'elsewhere' }] }) }), 'the origin changed too')
  refused(servePlan(), 'a certificate other than site_edge', OLD_EDGE_ARN)
  refused(servePlan({ pageHeaders: ['rsc', 'next-router-prefetch', 'next-router-state-tree', 'next-router-segment-prefetch'] }), 'the cache key without the viewer host')
  refused(servePlan({ client: { name: 'web', callback_urls: [...ORIGINS, 'https://evil.example'].map((o) => `${o}/auth/google/callback`), logout_urls: ORIGINS } }), 'an extra callback')
  refused(servePlan({ client: { name: 'web2', callback_urls: ORIGINS.map((o) => `${o}/auth/google/callback`), logout_urls: ORIGINS } }), 'a client change beyond its URLs')
  refused(servePlan({ corsOrigins: ['*'] }), 'CORS for every origin')
  refused(servePlan({ authorizerEnv: [{ variables: { REALTIME_TICKET_AUDIENCE: 'other', REALTIME_TICKET_SECRET_ARN: 'arn:secret', REALTIME_ALLOWED_ORIGINS: ORIGINS.join(',') } }] }), 'another authorizer variable changed')
  refused(servePlan({ 'record www.seanshore.net A': { name: 'www.seanshore.net', type: 'A', zone_id: 'Z09758912UIE2T2PK09U', records: null, alias: [{ name: 'elsewhere.cloudfront.net', zone_id: 'Z2FDTNDATAQYW2', evaluate_target_health: false }] } }), 'a record pointing elsewhere')
  refused(servePlan({ extra: [{ address: 'aws_route53_record.seanshore_legacy_apex', mode: 'managed', change: { actions: ['update'] } }] }), 'a seanshore.in record changed')
  refused(servePlan({ extra: [{ address: 'aws_acm_certificate.seanshore_edge', mode: 'managed', change: { actions: ['delete'] } }] }), 'the old certificate deleted')
  refused(servePlan().filter((c) => c.address !== 'aws_lambda_function.realtime_authorizer'), 'partly applied')
  refused(servePlan().map((c) => c.address === FUNCTION ? functionUpdate({ code: renderedFunction().replace("'www.' + ALIAS_HOSTS[i]", "'w.' + ALIAS_HOSTS[i]") }) : c), 'function code that is not the template')
})

test('serve: the runner plans it only after the create step, refuses existing records and checks both domains live', () => {
  assert.match(guardAction(read('./domain-move-infra-action.txt')), /^(plan|import-once|create-once|serve-once)$/)
  assert.match(script, /case "\$ACTION" in plan\|import-once\|create-once\|serve-once\) ;;/)
  assert.match(script, /\[\[ "\$IMPORTED" == true && "\$CREATED" == true \]\] && STEP=serve/)
  assert.match(script, /serve-once\) \[\[ "\$STEP" == serve \]\]/)
  const serveTargets = script.slice(script.indexOf('SERVE_TARGETS=('), script.indexOf('\n)\n', script.indexOf('SERVE_TARGETS=(')))
  assert.deepEqual([...serveTargets.matchAll(/"([^"]+)"/g)].map((m) => m[1]), [
    'aws_cloudfront_distribution.app', 'aws_cloudfront_function.canonical_host_redirect', 'aws_cloudfront_cache_policy.public_pages',
    'aws_route53_record.site_net_alias', 'aws_cognito_user_pool_client.web', 'aws_s3_bucket_cors_configuration.media',
    'aws_lambda_function.realtime_authorizer',
  ])
  // A seanshore.net A/AAAA record made elsewhere stops the run before anything is applied.
  const precheck = script.indexOf('EXISTING_NET_RECORDS="$(net_site_records any)"')
  assert.ok(precheck > 0 && precheck < script.indexOf('apply -input=false'))
  assert.match(script, /\[\[ "\$EXISTING_NET_RECORDS" == 0 \]\] \|\| \{ echo "DOMAIN_MOVE_INFRA=FAIL seanshore\.net already has A\/AAAA records; refusing\." >&2; exit 1; \}/)
  // Live checks only after serve-once: seanshore.net answers, www.seanshore.net -> seanshore.net, seanshore.in unchanged.
  const live = script.slice(script.indexOf('if [[ "$ACTION" == serve-once ]]; then\n  edge()'))
  assert.ok(live.length < script.length && script.indexOf('edge()') > script.indexOf('apply -input=false'))
  assert.match(live, /--connect-to "\$host:443:\$EDGE_HOST:443"/)
  assert.match(live, /"301 https:\/\/seanshore\.net\/help\?serve_check=1"/)
  assert.match(live, /"301 https:\/\/seanshore\.in\/help\?serve_check=1"/)
  assert.match(live, /== "https:\/\/seanshore\.net\/auth\/sign-in" \]\] && NET_STAYS=true/)
  assert.match(live, /-H 'x-sns-viewer-host: seanshore\.net' "https:\/\/seanshore\.in\/auth\/session-ended/)
  assert.match(live, /"\$NET_RECORDS" == 4 \]\]/)
})

test('serve: Terraform serves the alias hosts of scripts/aws/site-alias-hosts.txt, and nothing is deleted', () => {
  const edge = read('../../infra/aws/app/edge.tf')
  const aliases = read('./site-alias-hosts.txt').split(/\s+/).filter(Boolean)
  assert.match(edge, new RegExp(`site_alias_hosts = \\[${aliases.map((h) => `"${h.replaceAll('.', '\\.')}"`).join(', ')}\\]`))
  assert.match(edge, /browser_site_urls = concat\(\[local\.canonical_site_url\], \[for host in local\.site_alias_hosts : "https:\/\/\$\{host\}"\], \[local\.edge_site_url\]\)/)
  assert.match(edge, /acm_certificate_arn\s+= aws_acm_certificate\.site_edge\.arn/)
  assert.match(edge, /alias_hosts\s+= jsonencode\(local\.site_alias_hosts\)/)
  assert.match(edge, /"next-router-segment-prefetch", "x-sns-viewer-host"\]/)
  // The previous certificate stays.
  assert.match(read('../../infra/aws/app/seanshore_domain.tf'), /resource "aws_acm_certificate" "seanshore_edge" \{[^]*?prevent_destroy\s+= true/)
})
