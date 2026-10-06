import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// The Social Events runner prints, read-only and before its create-only classifier can refuse, which attributes an
// in-place update would change and which event names an event rule's pattern would add or drop.
const script = readFileSync(new URL('./social-events-infra.sh', import.meta.url), 'utf8')
const block = /# Read-only evidence[^\n]*\n[^\n]*\npython3 - "\$WORK_DIR\/plan\.json" <<'PY'\n([\s\S]*?)\nPY\n/.exec(script)

test('the evidence block runs before the classifier and only reads the plan', () => {
  assert.ok(block, 'evidence block present')
  assert.ok(script.indexOf(block[0]) < script.indexOf('CLASSIFICATION="$(node "$PLAN_CLASSIFIER"'))
  assert.doesNotMatch(block[1], /open\([^)]*['"]w|subprocess|os\.system|terraform|aws /)
})

test('an event rule update reports the added and removed event names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'social-events-'))
  try {
    const pattern = (types) => JSON.stringify({ source: ['sea-n-shore.social'], 'detail-type': types })
    writeFileSync(join(dir, 'plan.json'), JSON.stringify({ resource_changes: [
      { address: 'aws_cloudwatch_event_rule.notification_events', type: 'aws_cloudwatch_event_rule', change: { actions: ['update'],
        before: { name: 'n', event_pattern: pattern(['user.followed', 'old.event']), tags: {} },
        after: { name: 'n', event_pattern: pattern(['user.followed', 'post.commented', 'post.reacted']), tags: {} } } },
      { address: 'aws_sqs_queue.x', type: 'aws_sqs_queue', change: { actions: ['create'], before: null, after: {} } },
    ] }))
    const out = execFileSync('python3', ['-c', block[1], join(dir, 'plan.json')], { encoding: 'utf8' })
    assert.match(out, /^SOCIAL_EVENTS_UPDATE aws_cloudwatch_event_rule\.notification_events attributes=event_pattern$/m)
    assert.match(out, /^SOCIAL_EVENTS_RULE_DETAIL_TYPES_ADDED=\["post\.commented", "post\.reacted"\]$/m)
    assert.match(out, /^SOCIAL_EVENTS_RULE_DETAIL_TYPES_REMOVED=\["old\.event"\]$/m)
    assert.doesNotMatch(out, /aws_sqs_queue/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
