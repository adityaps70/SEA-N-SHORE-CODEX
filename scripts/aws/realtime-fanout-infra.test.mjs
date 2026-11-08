import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { guardAction } from './guard-value.mjs'

// Realtime fan-out runner (Round ARCH broadcast fix): may only update the fan-out Lambda's code in place and remove
// the one dynamodb:Scan statement from its role policy. Nothing else in a plan is accepted.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const script = read('./realtime-fanout-infra.sh')
const workflow = read('../../.github/workflows/aws-realtime-fanout-infra.yml')
const classifier = new URL('./check-realtime-fanout-plan.py', import.meta.url).pathname
const LAMBDA = 'aws_lambda_function.realtime_fanout'
const CONNECTION = 'aws_lambda_function.realtime_connection'
const POLICY = 'aws_iam_role_policy.realtime_fanout'
const ARCHIVE = 'data.archive_file.realtime_fanout'
const CONNECTION_ARCHIVE = 'data.archive_file.realtime_connection'
const SID = 'BroadcastFeedInvalidations'
const RULE = 'aws_cloudwatch_event_rule.realtime_events'
const ADDED = ['notification.created']

test('guarded, exact-head, plan by default, four targets, applies only the classified plan', () => {
  assert.ok(['plan', 'apply-once'].includes(guardAction(read('./realtime-fanout-infra-action.txt'))))
  assert.match(script, /REALTIME_FANOUT_INFRA_EXPECTED_SHA/)
  assert.match(script, /case "\$ACTION" in plan\|apply-once\) ;;/)
  assert.deepEqual(script.match(/-target="\$[A-Z_]+"/g), ['-target="$LAMBDA_ADDRESS"', '-target="$CONNECTION_LAMBDA_ADDRESS"', '-target="$POLICY_ADDRESS"', '-target="$RULE_ADDRESS"'])
  assert.match(script, /RULE_ADDRESS="aws_cloudwatch_event_rule\.realtime_events"/)
  assert.match(script, /RULE_ADDED_TYPES='\["notification\.created"\]'/)
  assert.match(script, /grep -q 'rule_types=\.\*"notification\.created"' <<<"\$LIVE_AFTER"/)
  assert.match(script, /CONNECTION_LAMBDA_ADDRESS="aws_lambda_function\.realtime_connection"/)
  assert.match(script, /LAMBDA_ADDRESS="aws_lambda_function\.realtime_fanout"/)
  assert.match(script, /POLICY_ADDRESS="aws_iam_role_policy\.realtime_fanout"/)
  assert.match(script, /REMOVED_SID="BroadcastFeedInvalidations"/)
  assert.match(script, /terraform_plan_bounded "\$WORK_DIR\/\$1\.log" -chdir="\$APP_DIR" plan /)
  assert.ok(script.indexOf('source scripts/aws/bootstrap-terraform-lock.sh') < script.indexOf('terraform -chdir'))
  const moved = script.indexOf('bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1')
  const apply = script.indexOf('terraform -chdir="$APP_DIR" apply -input=false -no-color -lock-timeout=60s "$WORK_DIR/before.tfplan"')
  assert.ok(moved > 0 && apply > moved)
  assert.ok(script.indexOf('if [[ "$ACTION" == "plan" ]]; then') < moved)
  assert.equal((script.match(/terraform -chdir="\$APP_DIR" apply/g) || []).length, 1)
  // After the apply: no difference left and the live policy has no Scan.
  assert.match(script, /grep -q ' scan_statements=0 ' <<<"\$LIVE_AFTER"/)
  assert.match(script, /REALTIME_FANOUT_APPLY_COMPLETE/)
  assert.match(workflow, /environment: staging-apply/)
  assert.match(workflow, /run: bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(workflow, /GUARD_FILE: scripts\/aws\/realtime-fanout-infra-action\.txt/)
  assert.match(workflow, /export REALTIME_FANOUT_INFRA_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /bash scripts\/aws\/realtime-fanout-infra\.sh/)
  assert.doesNotMatch(workflow, /social-events|SOCIAL_EVENTS/)
})

function classify(changes) {
  const dir = mkdtempSync(join(tmpdir(), 'fanout-'))
  try {
    writeFileSync(join(dir, 'plan.json'), JSON.stringify({ resource_changes: changes }))
    return spawnSync('python3', ['-I', classifier, join(dir, 'plan.json'), `${LAMBDA},${CONNECTION}`, POLICY, `${ARCHIVE},${CONNECTION_ARCHIVE}`, SID, RULE, JSON.stringify(ADDED)], { encoding: 'utf8' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const statement = (sid, action) => ({ Sid: sid, Effect: 'Allow', Action: action, Resource: 'arn:aws:dynamodb:ap-south-1:1:table/t' })
const KEEP = [statement('ReadAndCleanRealtimeConnections', ['dynamodb:Query', 'dynamodb:DeleteItem']), statement('ConsumeRealtimeQueue', ['sqs:ReceiveMessage'])]
const policyDoc = (items) => JSON.stringify({ Version: '2012-10-17', Statement: items })
const OLD_POLICY = policyDoc([KEEP[0], statement(SID, ['dynamodb:Scan']), KEEP[1]])
const NEW_POLICY = policyDoc(KEEP)
const policy = (before, after, actions = ['update'], extra = {}) => ({
  address: POLICY,
  change: { actions, before: { name: 'p', role: 'r', policy: before }, after: { name: 'p', role: 'r', policy: after, ...extra }, after_unknown: {} },
})
const lambda = (afterChanges, actions = ['update'], afterUnknown = { last_modified: true, version: true, qualified_arn: true }, address = LAMBDA) => ({
  address,
  change: {
    actions,
    before: { function_name: 'f', memory_size: 256, timeout: 20, source_code_hash: 'old', last_modified: 'x', version: '$LATEST' },
    after: { function_name: 'f', memory_size: 256, timeout: 20, source_code_hash: 'new', ...afterChanges },
    after_unknown: afterUnknown,
  },
})
const archiveRead = { address: ARCHIVE, change: { actions: ['read'], before: null, after: {} } }
const noop = (address) => ({ address, change: { actions: ['no-op'] } })

test('accepts the code update and the Scan statement removal, and reports no change once applied', () => {
  const both = classify([archiveRead, lambda({}), policy(OLD_POLICY, NEW_POLICY)])
  assert.equal(both.status, 0, both.stderr)
  assert.match(both.stdout, /^REALTIME_FANOUT_PLAN=CODE_AND_POLICY_UPDATE$/m)
  assert.match(both.stdout, /^REALTIME_FANOUT_CODE_CHANGES=aws_lambda_function\.realtime_fanout$/m)
  assert.match(both.stdout, /^REALTIME_FANOUT_POLICY_REMOVES=BroadcastFeedInvalidations$/m)

  assert.equal(classify([lambda({})]).status, 0)
  assert.equal(classify([policy(OLD_POLICY, NEW_POLICY)]).status, 0)

  const done = classify([archiveRead, noop(LAMBDA), noop(POLICY)])
  assert.equal(done.status, 0, done.stderr)
  assert.equal(done.stdout.trim(), 'REALTIME_FANOUT_PLAN=NO_CHANGES')
})

test('nested blocks with nothing unknown are not changes (Terraform writes [{}] or [false] for them)', () => {
  // First plan run 42457216357 refused the real code update over exactly these placeholders.
  const placeholders = { last_modified: true, version: true, qualified_arn: true, architectures: [false], environment: [{}], ephemeral_storage: [{}], logging_config: [{}], tracing_config: [{}] }
  const accepted = classify([archiveRead, lambda({}, ['update'], placeholders), policy(OLD_POLICY, NEW_POLICY)])
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.match(accepted.stdout, /^REALTIME_FANOUT_PLAN=CODE_AND_POLICY_UPDATE$/m)
  // A real unknown inside a block still refuses.
  const refused = classify([lambda({}, ['update'], { ...placeholders, environment: [{ variables: true }] })])
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /changes more than its code: \['environment'\]/)
  const refusedPolicy = classify([{ ...policy(OLD_POLICY, NEW_POLICY), change: { ...policy(OLD_POLICY, NEW_POLICY).change, after_unknown: { policy: true } } }])
  assert.notEqual(refusedPolicy.status, 0)
  assert.match(refusedPolicy.stderr, /unknown values/)
})

test("Phase 5: accepts the connection Lambda's code update too, and refuses anything else on it", () => {
  const connectionRead = { address: CONNECTION_ARCHIVE, change: { actions: ['read'], before: null, after: {} } }
  const accepted = classify([archiveRead, connectionRead, lambda({}, ['update'], undefined, CONNECTION)])
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.match(accepted.stdout, /^REALTIME_FANOUT_CODE_CHANGES=aws_lambda_function\.realtime_connection$/m)
  assert.match(accepted.stdout, /^REALTIME_FANOUT_POLICY_REMOVES=none$/m)
  const refused = classify([lambda({ memory_size: 512 }, ['update'], undefined, CONNECTION)])
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /changes more than its code/)
  const authorizer = classify([lambda({}, ['update'], undefined, 'aws_lambda_function.realtime_authorizer')])
  assert.notEqual(authorizer.status, 0)
  assert.match(authorizer.stderr, /Refusing: the plan changes/)
})

const pattern = (types, source = ['sea-n-shore.social']) => JSON.stringify({ source, 'detail-type': types })
const OLD_TYPES = ['message.created', 'feed.post_created', 'connection.accepted']
const rule = (before, after, actions = ['update'], extra = {}) => ({
  address: RULE,
  change: { actions, before: { name: 'r', tags: {}, event_pattern: before }, after: { name: 'r', tags: {}, event_pattern: after, ...extra }, after_unknown: {} },
})

test('Phase 5: accepts the realtime rule gaining exactly notification.created, nothing else', () => {
  const accepted = classify([rule(pattern(OLD_TYPES), pattern([...OLD_TYPES, 'notification.created']))])
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.match(accepted.stdout, /^REALTIME_FANOUT_RULE_ADDS=\["notification\.created"\]$/m)
  for (const [changes, reason] of [
    [[rule(pattern(OLD_TYPES), pattern([...OLD_TYPES, 'notification.created', 'user.followed']))], /adds \['notification\.created', 'user\.followed'\]/],
    [[rule(pattern(OLD_TYPES), pattern(['message.created', 'notification.created']))], /would drop/],
    [[rule(pattern(OLD_TYPES), pattern([...OLD_TYPES, 'notification.created'], ['other.source']))], /more than its detail-type list/],
    [[rule(pattern(OLD_TYPES), pattern([...OLD_TYPES, 'notification.created']), ['update'], { name: 'other' })], /other than the rule pattern/],
    [[rule(pattern(OLD_TYPES), pattern([...OLD_TYPES, 'notification.created']), ['delete', 'create'])], /not an in-place update/],
  ]) {
    const result = classify(changes)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, reason)
  }
})

test('refuses any other Lambda change', () => {
  for (const [changes, reason] of [
    [[lambda({ memory_size: 512 })], /changes more than its code/],
    [[lambda({ timeout: 60 })], /changes more than its code/],
    [[lambda({ source_code_hash: 'old' }, ['update'], {})], /does not change its code/],
    [[lambda({}, ['delete', 'create'])], /not an in-place update/],
    [[lambda({}, ['update'], { environment: true })], /changes more than its code/],
  ]) {
    const result = classify(changes)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, reason)
  }
})

test('refuses any policy change but removing exactly the Scan statement', () => {
  const widened = policyDoc([...KEEP, statement('Extra', ['dynamodb:*'])])
  const reordered = policyDoc([KEEP[1], KEEP[0]])
  const changedKept = policyDoc([statement('ReadAndCleanRealtimeConnections', ['dynamodb:*']), KEEP[1]])
  const removedOther = policyDoc([statement(SID, ['dynamodb:Scan']), KEEP[1]])
  for (const [changes, reason] of [
    [[policy(OLD_POLICY, widened)], /adds or changes statements/],
    [[policy(OLD_POLICY, changedKept)], /adds or changes statements/],
    [[policy(OLD_POLICY, removedOther)], /removes \['ReadAndCleanRealtimeConnections'\]/],
    [[policy(policyDoc(KEEP), reordered)], /removes \[\], expected exactly|reordered/],
    [[policy(OLD_POLICY, NEW_POLICY, ['update'], { role: 'other' })], /attributes other than the policy document/],
    [[policy(OLD_POLICY, NEW_POLICY, ['delete'])], /not an in-place update/],
  ]) {
    const result = classify(changes)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, reason)
  }
})

test('refuses any other resource, and a repeated address', () => {
  for (const changes of [
    [lambda({}), { address: 'aws_dynamodb_table.realtime_connections', change: { actions: ['update'], before: {}, after: {} } }],
    [{ address: 'aws_iam_role.realtime_fanout', change: { actions: ['update'], before: {}, after: {} } }],
    [{ address: ARCHIVE, change: { actions: ['create'], before: null, after: {} } }],
    [lambda({}), lambda({})],
  ]) {
    const result = classify(changes)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Refusing: the plan changes/)
  }
})

test('the Terraform the runner applies matches what the classifier allows', () => {
  const terraform = read('../../infra/aws/app/realtime.tf')
  assert.doesNotMatch(terraform, /"dynamodb:Scan"|BroadcastFeedInvalidations/)
  assert.match(terraform, /resource "aws_lambda_function" "realtime_fanout"/)
  assert.match(terraform, /resource "aws_iam_role_policy" "realtime_fanout"/)
  assert.match(terraform, /data "archive_file" "realtime_fanout"/)
})
