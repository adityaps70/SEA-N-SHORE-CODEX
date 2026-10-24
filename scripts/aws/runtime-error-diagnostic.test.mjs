import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Hotfix (Oct 2026): the runtime error diagnostic also ties an error page's reference (the digest) to the server-side
// message, and totals the CSP report-only summaries. Read-only; placeholder log lines only.
const workflow = readFileSync('.github/workflows/aws-runtime-error-diagnostic.yml', 'utf8')

function jq(filter, events) {
  return execFileSync('jq', ['-r', '-f', filter], { input: JSON.stringify({ events }), encoding: 'utf8' })
}

const event = (logStreamName, timestamp, message) => ({ logStreamName, timestamp, message })

test('groups server render errors by digest with the message logged before it', () => {
  const out = jq('scripts/aws/render-error-digests.jq', [
    event('a', 1_760_000_000_000, ' ⨯ Error: Functions cannot be passed directly to Client Components'),
    event('a', 1_760_000_000_001, '    at stringify (<anonymous>) {'),
    event('a', 1_760_000_000_002, "  digest: '1014826221'"),
    event('b', 1_760_000_060_000, "  digest: '1014826221'"),
    event('b', 1_760_000_120_000, '  digest: "42"'),
    event('b', 1_760_000_180_000, 'GET /home 200'),
  ])
  const rows = out.trim().split('\n').map((line) => line.split('\t'))
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0].slice(0, 4), ['2', '1014826221', '2025-10-09T08:53:20Z', '2025-10-09T08:54:20Z'])
  assert.match(rows[0][4], /Functions cannot be passed directly to Client Components .*digest: '1014826221'/)
  assert.deepEqual(rows[1].slice(0, 2), ['1', '42'])
  assert.equal(jq('scripts/aws/render-error-digests.jq', []), '')
})

test('totals CSP summaries per directive and blocked host, and says when there are none', () => {
  const summary = (total, violations) => JSON.stringify({ event: 'csp_violation_summary', windowSeconds: 60, total, violations })
  const out = jq('scripts/aws/csp-violation-summary.jq', [
    event('a', 1_760_000_000_000, summary(3, [{ directive: 'script-src-elem', blocked: 'inline', count: 2 }, { directive: 'img-src', blocked: 'cdn.example.com', count: 1 }])),
    event('b', 1_760_000_600_000, JSON.stringify({ ...JSON.parse(summary(1, [{ directive: 'script-src-elem', blocked: 'inline', count: 1 }])), rateLimited: 7 })),
    event('b', 1_760_000_700_000, 'not json'),
  ]).trim().split('\n')
  assert.deepEqual(out, [
    'CSP_SUMMARY_LINES=2',
    'CSP_TOTAL_REPORTS=4',
    'CSP_RATE_LIMITED_REQUESTS=7',
    'CSP_FIRST_SUMMARY_AT=2025-10-09T08:53:20Z',
    'CSP_LAST_SUMMARY_AT=2025-10-09T09:03:20Z',
    '3\tscript-src-elem\tinline',
    '1\timg-src\tcdn.example.com',
  ])
  assert.deepEqual(jq('scripts/aws/csp-violation-summary.jq', []).trim().split('\n'), [
    'CSP_SUMMARY_LINES=0',
    'CSP_TOTAL_REPORTS=0',
    'CSP_RATE_LIMITED_REQUESTS=0',
    'CSP_FIRST_SUMMARY_AT=none',
    'CSP_LAST_SUMMARY_AT=none',
  ])
})

test('the workflow only reads: describe and filter calls, emails redacted, bounded CSP window', () => {
  const awsCalls = [...workflow.matchAll(/\baws (\S+) (\S+)/g)].map((match) => `${match[1]} ${match[2]}`)
  assert.ok(awsCalls.length > 0)
  for (const call of awsCalls) assert.match(call, /^(ecs describe-services|ecs describe-task-definition|logs filter-log-events)$/, call)
  assert.match(workflow, /jq -r -f scripts\/aws\/render-error-digests\.jq \/tmp\/events\.json \\\n\s+\| sed -E 's\/\[A-Za-z0-9\._%\+-\]\+@/)
  assert.match(workflow, /--filter-pattern '\{ \$\.event = "csp_violation_summary" \}'/)
  assert.match(workflow, /CSP_SINCE_HOURS >= 1 && CSP_SINCE_HOURS <= 720/)
  // head would close the pipe early and fail the step under pipefail.
  assert.doesNotMatch(workflow, /\| head\b/)
})
