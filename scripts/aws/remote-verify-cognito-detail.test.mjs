import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// Round ARCH: the report-only Cognito detail in Remote Verify prints the error code and the app route, nothing else.
const script = 'scripts/aws/remote-verify-cognito-detail.py'
const workflow = readFileSync('.github/workflows/aws-remote-verify.yml', 'utf8')

function run(events) {
  const dir = mkdtempSync(join(tmpdir(), 'cognito-detail-'))
  const file = join(dir, 'events.json')
  writeFileSync(file, JSON.stringify({ events }))
  const result = spawnSync('python3', ['-I', script, file], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

test('prints the code and route of each "Cognito request failed" error, from the lines that follow it', () => {
  const stream = 'web/web/abc'
  const output = run([
    { logStreamName: stream, timestamp: 1000, eventId: '1', message: ' ⨯ Error [CognitoApiError]: Cognito request failed.' },
    { logStreamName: stream, timestamp: 1001, eventId: '2', message: '    at request (/app/.next/server/chunks/123.js:1:2)' },
    { logStreamName: stream, timestamp: 1001, eventId: '3', message: '    at POST (/app/.next/server/app/api/realtime/ticket/route.js:1:9)' },
    { logStreamName: stream, timestamp: 1002, eventId: '4', message: "  code: 'TransportError'," },
    { logStreamName: stream, timestamp: 1002, eventId: '5', message: "  reason: null, email: 'someone@example.com', token: 'eyJabc.def'" },
    // A second one on a page, with its fields inside the same event.
    { logStreamName: 'web/web/def', timestamp: 5000, eventId: '6', message: "Error [CognitoApiError]: Cognito request failed.\n    at x (/app/.next/server/app/(app)/home/page.js:3:4) {\n  code: 'InternalErrorException'\n}" },
    // One whose details are too late (over 2 s) to belong to it.
    { logStreamName: 'web/web/ghi', timestamp: 9000, eventId: '7', message: 'Error [CognitoApiError]: Cognito request failed.' },
    { logStreamName: 'web/web/ghi', timestamp: 12000, eventId: '8', message: "  code: 'LateCode'," },
  ])
  assert.match(output, /^COGNITO_FAILED_DETAIL count=1 code=TransportError route=\/api\/realtime\/ticket \(route\)$/m)
  assert.match(output, /^COGNITO_FAILED_DETAIL count=1 code=InternalErrorException route=\/\(app\)\/home \(page\)$/m)
  assert.match(output, /^COGNITO_FAILED_DETAIL count=1 code=unknown route=unknown$/m)
  assert.match(output, /^COGNITO_FAILED_TOTAL=3$/m)
  // Nothing but the code and the route path ever comes out.
  assert.doesNotMatch(output, /example\.com|eyJ|someone|LateCode|chunks/)
})

test('prints a zero total when there is no such error', () => {
  assert.match(run([{ logStreamName: 's', timestamp: 1, eventId: '1', message: 'Error [CognitoApiError]: Cognito request was not authorized.' }]), /^COGNITO_FAILED_TOTAL=0$/m)
})

test('Remote Verify checks out the repo in the runtime job and runs it, report-only, on both windows', () => {
  const job = workflow.slice(workflow.indexOf('  staging-runtime-shape:'), workflow.indexOf('Inspect live ECS rollout and Aurora runtime shape'))
  assert.match(job, /uses: actions\/checkout@/)
  assert.match(workflow, /python3 -I scripts\/aws\/remote-verify-cognito-detail\.py \/tmp\/remote-verify-cloudwatch\.json \|\| true/)
  assert.match(workflow, /python3 -I scripts\/aws\/remote-verify-cognito-detail\.py \/tmp\/remote-verify-types-since\.json \|\| true/)
})
