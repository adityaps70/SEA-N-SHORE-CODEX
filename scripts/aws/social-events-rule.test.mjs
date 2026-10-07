import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { guardAction } from './guard-value.mjs'

// The Social Events notification rule runner may only update aws_cloudwatch_event_rule.notification_events in
// place, adding exactly the six feed event names to its pattern. Worker task definitions are never touched.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const script = read('./social-events-rule.sh')
const workflow = read('../../.github/workflows/aws-social-events-rule.yml')
const classifyBlock = /classify\(\) \{\n  python3 - "\$1" "\$RULE_ADDRESS" "\$ADDED_TYPES" <<'PY'\n([\s\S]*?)\nPY\n\}/.exec(script)[1]
const ADDED = ['comment.mentioned', 'comment.reacted', 'comment.replied', 'post.commented', 'post.mentioned', 'post.reacted']
const OLD = ['connection.accepted', 'connection.requested', 'user.followed']

test('guarded, exact-head, plan by default, one target, applies only the classified plan', () => {
  assert.ok(['plan', 'apply-once'].includes(guardAction(read('./social-events-rule-action.txt'))))
  assert.match(script, /SOCIAL_EVENTS_RULE_EXPECTED_SHA/)
  assert.match(script, /case "\$ACTION" in plan\|apply-once\) ;;/)
  assert.match(script, /RULE_ADDRESS="aws_cloudwatch_event_rule\.notification_events"/)
  assert.equal((script.match(/-target=/g) || []).length, 1)
  assert.match(script, /-target="\$RULE_ADDRESS"/)
  assert.match(script, /terraform_plan_bounded "\$WORK_DIR\/\$1\.log" -chdir="\$APP_DIR" plan /)
  assert.doesNotMatch(script, /^\s*terraform -chdir="\$APP_DIR" plan /m)
  assert.ok(script.indexOf('source scripts/aws/bootstrap-terraform-lock.sh') < script.indexOf('terraform -chdir'))
  const code = script.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
  assert.doesNotMatch(code, /notification_worker|outbox_worker|aws_ecs_service|-target=aws_ecs/)
  assert.match(script, new RegExp(`ADDED_TYPES='${JSON.stringify(ADDED).replace(/[[\]]/g, '\\$&')}'`))
  // Moved-branch check, then apply of the saved, classified plan file (never a fresh apply).
  const moved = script.indexOf('bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1')
  const apply = script.indexOf('terraform -chdir="$APP_DIR" apply -input=false -no-color -lock-timeout=60s "$WORK_DIR/before.tfplan"')
  assert.ok(moved > 0 && apply > moved)
  assert.ok(script.indexOf('if [[ "$ACTION" == "plan" ]]; then') < moved)
  assert.equal((script.match(/terraform -chdir="\$APP_DIR" apply/g) || []).length, 1)
  assert.match(script, /SOCIAL_EVENTS_RULE_APPLY_COMPLETE/)
  // Approval and arm guard wiring like every armed runner.
  assert.match(workflow, /environment: staging-apply/)
  assert.match(workflow, /run: bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(workflow, /GUARD_FILE: scripts\/aws\/social-events-rule-action\.txt/)
})

function classify(changes) {
  const dir = mkdtempSync(join(tmpdir(), 'rule-'))
  try {
    writeFileSync(join(dir, 'plan.json'), JSON.stringify({ resource_changes: changes }))
    return spawnSync('python3', ['-c', classifyBlock, join(dir, 'plan.json'), 'aws_cloudwatch_event_rule.notification_events', JSON.stringify(ADDED)], { encoding: 'utf8' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
const pattern = (types, source = ['sea-n-shore.social']) => JSON.stringify({ source, 'detail-type': types })
const rule = (before, after, actions = ['update'], extra = {}) => ({
  address: 'aws_cloudwatch_event_rule.notification_events',
  change: { actions, before: { name: 'n', tags: {}, event_pattern: before }, after: { name: 'n', tags: {}, event_pattern: after, ...extra }, after_unknown: {} },
})

test('the classifier accepts only the exact pattern update, and reports no change once applied', () => {
  const ok = classify([rule(pattern(OLD), pattern([...OLD, ...ADDED]))])
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, /SOCIAL_EVENTS_RULE_PLAN=PATTERN_UPDATE_ONLY/)
  assert.match(ok.stdout, /SOCIAL_EVENTS_RULE_DETAIL_TYPES_ADDED=\["comment\.mentioned", "comment\.reacted", "comment\.replied", "post\.commented", "post\.mentioned", "post\.reacted"\]/)
  const done = classify([{ address: 'aws_cloudwatch_event_rule.notification_events', change: { actions: ['no-op'] } }])
  assert.equal(done.status, 0)
  assert.match(done.stdout, /SOCIAL_EVENTS_RULE_PLAN=NO_CHANGES/)

  const refuse = (label, changes, reason) => {
    const r = classify(changes)
    assert.notEqual(r.status, 0, label)
    assert.match(r.stderr, reason, label)
  }
  const good = rule(pattern(OLD), pattern([...OLD, ...ADDED]))
  const worker = { address: 'aws_ecs_task_definition.notification_worker', change: { actions: ['delete', 'create'], before: {}, after: {} } }
  refuse('a worker task definition alongside', [good, worker], /the plan changes/)
  refuse('replace instead of update', [rule(pattern(OLD), pattern([...OLD, ...ADDED]), ['delete', 'create'])], /not an in-place update/)
  refuse('another attribute changes', [rule(pattern(OLD), pattern([...OLD, ...ADDED]), ['update'], { tags: { x: '1' } })], /attributes other than event_pattern/)
  refuse('drops an event name', [rule(pattern(OLD), pattern([...OLD.slice(1), ...ADDED]))], /would drop/)
  refuse('adds a different set', [rule(pattern(OLD), pattern([...OLD, ...ADDED, 'job.applied']))], /expected exactly/)
  refuse('adds only some', [rule(pattern(OLD), pattern([...OLD, ...ADDED.slice(1)]))], /expected exactly/)
  refuse('changes the source', [rule(pattern(OLD), pattern([...OLD, ...ADDED], ['other.source']))], /more than its detail-type list/)
  refuse('another resource only', [{ ...good, address: 'aws_cloudwatch_event_rule.other' }], /the plan changes/)
})
