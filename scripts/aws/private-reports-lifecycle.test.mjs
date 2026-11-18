import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { guardAction } from './guard-value.mjs'

// Private reports (owner-approved 17 Nov): one lifecycle rule on the private migration bucket. Everything under
// private-reports/ is deleted 14 days after it is written and the older versions 1 day after that. Nothing else in the
// bucket changes, and the run stops if anything is already under private-reports/.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const script = read('./private-reports-lifecycle.sh')
const workflow = read('../../.github/workflows/aws-private-reports-lifecycle.yml')
const storage = read('../../infra/aws/app/storage.tf')
const classifier = new URL('./check-private-reports-lifecycle-plan.py', import.meta.url).pathname

const ADDRESS = 'aws_s3_bucket_lifecycle_configuration.migration_backup'
const BUCKET = 'sea-n-shore-staging-310356785722-migration'
// The provider's plan JSON shape for the two rules (empty blocks and defaults included, as Terraform writes them).
const abortRule = {
  id: 'abort-incomplete-multipart', status: 'Enabled', prefix: '',
  filter: [{ and: [], object_size_greater_than: null, object_size_less_than: null, prefix: '', tag: [] }],
  abort_incomplete_multipart_upload: [{ days_after_initiation: 7 }],
  expiration: [], noncurrent_version_expiration: [], noncurrent_version_transition: [], transition: [],
}
const reportsRule = {
  id: 'expire-private-reports-after-14-days', status: 'Enabled', prefix: '',
  filter: [{ and: [], object_size_greater_than: null, object_size_less_than: null, prefix: 'private-reports/', tag: [] }],
  abort_incomplete_multipart_upload: [],
  expiration: [{ date: null, days: 14, expired_object_delete_marker: false }],
  noncurrent_version_expiration: [{ newer_noncurrent_versions: null, noncurrent_days: 1 }],
  noncurrent_version_transition: [], transition: [],
}
const config = (rules) => ({ bucket: BUCKET, expected_bucket_owner: '', id: BUCKET, rule: rules, timeouts: null, transition_default_minimum_object_size: 'all_storage_classes_128K' })

function plan(changes) {
  return { resource_changes: changes }
}
function update(before, after, extra = {}) {
  return { address: ADDRESS, mode: 'managed', change: { actions: ['update'], before, after, after_unknown: {} }, ...extra }
}
function classify(planJson) {
  const dir = mkdtempSync(join(tmpdir(), 'private-reports-plan-'))
  const path = join(dir, 'plan.json')
  writeFileSync(path, JSON.stringify(planJson))
  return spawnSync('python3', ['-I', classifier, path], { encoding: 'utf8' })
}
function live(rules) {
  return spawnSync('python3', ['-I', classifier, '--live'], { input: JSON.stringify({ Rules: rules }), encoding: 'utf8' }).stdout.trim()
}
const approved = () => plan([update(config([abortRule]), config([abortRule, reportsRule]))])

test('the guard reads plan, or apply-once with the exact SHA it arms', () => {
  const action = guardAction(read('./private-reports-lifecycle-action.txt'))
  assert.ok(['plan', 'apply-once'].includes(action), `Unexpected private reports lifecycle action: ${action}`)
})

test('the Terraform rule is the approved one: private-reports/, 14 days, older versions 1 day later', () => {
  const block = storage.slice(storage.indexOf('resource "aws_s3_bucket_lifecycle_configuration" "migration_backup"'))
  const body = block.slice(0, block.indexOf('\n}\n') + 3)
  assert.match(body, /rule \{\n    id     = "abort-incomplete-multipart"\n    status = "Enabled"\n\n    filter \{\}\n\n    abort_incomplete_multipart_upload \{\n      days_after_initiation = 7\n    \}\n  \}/)
  assert.match(body, /rule \{\n    id     = "expire-private-reports-after-14-days"\n    status = "Enabled"\n\n    filter \{\n      prefix = "private-reports\/"\n    \}\n\n    expiration \{\n      days = 14\n    \}\n\n    noncurrent_version_expiration \{\n      noncurrent_days = 1\n    \}\n  \}/)
  assert.equal((body.match(/^  rule \{$/gm) ?? []).length, 2, 'exactly two rules on the migration bucket')
  // The whole private-reports/ prefix, not one report's folder.
  assert.doesNotMatch(body, /private-reports\/[a-z]/)
})

test('the plan checker accepts exactly the approved addition, or no change once applied', () => {
  const ok = classify(approved())
  assert.equal(ok.status, 0, ok.stdout + ok.stderr)
  assert.match(ok.stdout, /^PRIVATE_REPORTS_LIFECYCLE_PLAN=ADD_RULE$/m)
  const done = classify(plan([{ address: ADDRESS, mode: 'managed', change: { actions: ['no-op'], before: config([abortRule, reportsRule]), after: config([abortRule, reportsRule]) } }]))
  assert.equal(done.status, 0, done.stdout)
  assert.match(done.stdout, /^PRIVATE_REPORTS_LIFECYCLE_PLAN=NO_CHANGES$/m)
  // Data sources in the plan are ignored.
  const withData = approved()
  withData.resource_changes.push({ address: 'data.aws_caller_identity.current', mode: 'data', change: { actions: ['read'] } })
  assert.equal(classify(withData).status, 0)
})

test('the plan checker refuses anything else', () => {
  const refused = (planJson, why) => {
    const result = classify(planJson)
    assert.notEqual(result.status, 0, why)
    assert.match(result.stdout, /PRIVATE_REPORTS_LIFECYCLE_PLAN_REFUSED/, why)
  }
  const changed = (field, value) => ({ ...reportsRule, [field]: value })
  refused(plan([update(config([abortRule]), config([abortRule, changed('expiration', [{ days: 7 }])]))]), 'a 7-day expiry')
  refused(plan([update(config([abortRule]), config([abortRule, changed('noncurrent_version_expiration', [])]))]), 'old versions kept')
  refused(plan([update(config([abortRule]), config([abortRule, changed('filter', [{ prefix: 'private-reports/domain-move/' }])]))]), 'a narrower prefix')
  refused(plan([update(config([abortRule]), config([abortRule, changed('filter', [{}])]))]), 'the whole bucket')
  refused(plan([update(config([abortRule]), config([reportsRule]))]), 'the existing rule dropped')
  refused(plan([update(config([abortRule]), config([{ ...abortRule, abort_incomplete_multipart_upload: [{ days_after_initiation: 1 }] }, reportsRule]))]), 'the existing rule changed')
  refused(plan([update(config([abortRule, { ...abortRule, id: 'other' }]), config([abortRule, reportsRule]))]), 'unexpected existing rules')
  refused(plan([update(config([abortRule]), config([abortRule, reportsRule, { ...reportsRule, id: 'extra' }]))]), 'an extra rule')
  refused(plan([update({ ...config([abortRule]), bucket: 'other' }, { ...config([abortRule, reportsRule]), bucket: 'other' })]), 'another bucket')
  refused(plan([update(config([abortRule]), { ...config([abortRule, reportsRule]), expected_bucket_owner: '123' })]), 'another attribute')
  refused(plan([{ ...update(config([abortRule]), config([abortRule, reportsRule])), change: { actions: ['delete', 'create'], before: config([abortRule]), after: config([abortRule, reportsRule]) } }]), 'a replacement')
  refused(plan([...approved().resource_changes, { address: 'aws_s3_bucket.app["migration_backup"]', mode: 'managed', change: { actions: ['update'] } }]), 'another resource')
  refused(plan([]), 'the resource missing from the plan')
})

test('the live check accepts exactly the two approved rules', () => {
  const abort = { ID: 'abort-incomplete-multipart', Status: 'Enabled', Filter: {}, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 } }
  const reports = { ID: 'expire-private-reports-after-14-days', Status: 'Enabled', Filter: { Prefix: 'private-reports/' }, Expiration: { Days: 14 }, NoncurrentVersionExpiration: { NoncurrentDays: 1 } }
  assert.equal(live([reports, abort]), 'true')
  assert.equal(live([{ ...abort, Filter: { Prefix: '' } }, reports]), 'true', 'an empty prefix is the whole bucket, as before')
  assert.equal(live([abort]), 'false')
  assert.equal(live([abort, { ...reports, Expiration: { Days: 30 } }]), 'false')
  assert.equal(live([abort, { ...reports, Status: 'Disabled' }]), 'false')
  assert.equal(live([abort, { ...reports, NoncurrentVersionExpiration: { NoncurrentDays: 1, NewerNoncurrentVersions: 3 } }]), 'false')
  assert.equal(live([abort, { ...reports, Filter: { And: { Prefix: 'private-reports/' } } }]), 'false')
  assert.equal(live([abort, reports, { ...reports, ID: 'x' }]), 'false')
})

test('the runner targets only the lifecycle configuration and refuses anything already under private-reports/', () => {
  assert.match(script, /^RESOURCE="aws_s3_bucket_lifecycle_configuration\.migration_backup"$/m)
  assert.equal((script.match(/-target=/g) ?? []).length, 1)
  assert.match(script, /-target="\$RESOURCE"/)
  assert.match(script, /^BUCKET="sea-n-shore-staging-310356785722-migration"$/m)
  assert.match(script, /^REPORTS_PREFIX="private-reports\/"$/m)
  // The count runs before any plan, and again right before the apply.
  const count = script.indexOf('EXISTING="$(existing_objects)"')
  assert.ok(count > 0 && count < script.indexOf('plan before'), 'existing objects are counted before the plan')
  assert.match(script, /\[\[ "\$EXISTING" == 0 \]\] \|\| \{\n\s+echo "PRIVATE_REPORTS_LIFECYCLE=FAIL/)
  const recount = script.indexOf('[[ "$(existing_objects)" == 0 ]]')
  assert.ok(recount > script.indexOf('branch-head.sh') && recount < script.indexOf('apply -input=false'), 're-counted right before the apply')
  // Counts only: versions and delete markers are counted, never printed.
  assert.match(script, /jq -s '\[\.\[\] \| \(\(\.Versions \/\/ \[\]\) \+ \(\.DeleteMarkers \/\/ \[\]\)\)\[\]\] \| length'/)
  assert.doesNotMatch(script, /\.Key\b|"Key"/)
  // Every AWS call reads, except the one Terraform apply of the classified plan.
  const calls = [...script.matchAll(/\baws ([a-z0-9]+) ([a-z-]+)/g)].map((m) => `${m[1]} ${m[2]}`)
  for (const call of calls) assert.match(call, /^(sts get-caller-identity|s3api (list-object-versions|get-object|get-bucket-lifecycle-configuration))$/, call)
  assert.equal((script.match(/terraform -chdir="\$APP_DIR" apply /g) ?? []).length, 1)
  assert.match(script, /apply -input=false -no-color -lock-timeout=60s "\$WORK_DIR\/before\.tfplan"/)
  // Apply only on apply-once, after the moved-branch check, and verified afterwards.
  assert.ok(script.indexOf('if [[ "$ACTION" == "plan" ]]') < script.indexOf('apply -input=false'))
  assert.ok(script.indexOf('branch-head.sh refs/heads/feat/aws-native-phase-0-1') < script.indexOf('apply -input=false'))
  assert.match(script, /\[\[ "\$LIVE" == true \]\]/)
  assert.match(script, /echo "PRIVATE_REPORTS_LIFECYCLE_VERIFIED=true"/)
  assert.match(script, /source scripts\/aws\/bootstrap-terraform-lock\.sh/)
})

test('the workflow runs the guarded host runner from the exact armed commit', () => {
  assert.match(workflow, /^name: AWS Private Reports Lifecycle$/m)
  assert.match(workflow, /- infra\/aws\/app\/storage\.tf\n/)
  assert.match(workflow, /GUARD_FILE: scripts\/aws\/private-reports-lifecycle-action\.txt/)
  assert.match(workflow, /export PRIVATE_REPORTS_LIFECYCLE_EXPECTED_SHA=\{sha\}\n\s+bash scripts\/aws\/private-reports-lifecycle\.sh/)
  assert.match(workflow, /plan\|discover\) echo "approval=false"/)
  assert.doesNotMatch(workflow, /load-test|handoff/i)
})
