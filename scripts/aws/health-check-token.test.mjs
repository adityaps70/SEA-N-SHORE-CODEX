// Round 15: the verify workflows send the deep health check token (x-health-check-token) read from
// Secrets Manager with the deploy role. The token is masked first, never echoed, and handed to curl
// through a header file; a missing token is tolerated only while the live web task does not use it.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const read = (path) => readFileSync(path, 'utf8')
const helper = read('scripts/aws/health-check-token-header.sh')
const remoteVerify = read('.github/workflows/aws-remote-verify.yml')
const realtimeE2e = read('.github/workflows/aws-realtime-e2e.yml')
const ci = read('.github/workflows/aws-infra-ci.yml')
const TOKEN = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3x4Y5z6A7b8C9d0E1f2'

function run({ requires, secret }) {
  const dir = mkdtempSync(join(tmpdir(), 'health-token-'))
  try {
    const taskDefinition = JSON.stringify({ containerDefinitions: [{ name: 'web', secrets: requires ? [{ name: 'HEALTH_CHECK_TOKEN', valueFrom: 'arn' }] : [{ name: 'AURORA_USER', valueFrom: 'arn' }] }] })
    writeFileSync(join(dir, 'aws'), `#!/usr/bin/env bash
case "$1 $2" in
  "ecs describe-services") echo "arn:aws:ecs:ap-south-1:310356785722:task-definition/sea-n-shore-staging-web:9" ;;
  "ecs describe-task-definition") echo '${taskDefinition}' ;;
  "secretsmanager get-secret-value")
    [[ " $* " == *" --secret-id sea-n-shore-staging/health-check-token "* ]] || exit 3
    if [[ -n "$STUB_SECRET" ]]; then printf '%s\\n' "$STUB_SECRET"; else echo "AccessDeniedException" >&2; exit 254; fi ;;
  *) exit 2 ;;
esac
`)
    chmodSync(join(dir, 'aws'), 0o755)
    const header = join(dir, 'header')
    const script = `set -euo pipefail\nsource scripts/aws/health-check-token-header.sh\nwrite_health_check_header "${header}"\n`
    let output = ''
    let ok = true
    try {
      output = execFileSync('bash', ['-c', script], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, STUB_SECRET: secret ?? '' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      ok = false
      output = `${error.stdout ?? ''}${error.stderr ?? ''}`
    }
    return { ok, output, header: read(header), mode: statSync(header).mode & 0o777 }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the token is masked before any use, written only to a private header file and never echoed', () => {
  const result = run({ requires: true, secret: TOKEN })
  assert.equal(result.ok, true, result.output)
  assert.equal(result.header, `x-health-check-token: ${TOKEN}\n`)
  assert.equal(result.mode, 0o600)
  const lines = result.output.split('\n').filter((line) => line.includes(TOKEN))
  assert.deepEqual(lines, [`::add-mask::${TOKEN}`], 'the only log line carrying the token is the mask command')
  assert.match(result.output, /HEALTH_CHECK_TOKEN_SENT=true/)
  assert.ok(helper.indexOf('echo "::add-mask::$token"') < helper.indexOf("printf 'x-health-check-token: %s\\n' \"$token\""))
  assert.match(helper, /aws secretsmanager get-secret-value --secret-id "\$HEALTH_CHECK_TOKEN_SECRET_ID" --query SecretString --output text 2>\/dev\/null/)
  assert.doesNotMatch(helper, /echo[^\n]*\$token(?!")|echo "\$token"|set -x/)
})

test('before the release a missing token is tolerated; once the live task uses it, it is required', () => {
  const before = run({ requires: false, secret: '' })
  assert.equal(before.ok, true, before.output)
  assert.equal(before.header, '')
  assert.match(before.output, /HEALTH_CHECK_TOKEN_SENT=false/)
  assert.match(before.output, /::warning::/)

  const after = run({ requires: true, secret: '' })
  assert.equal(after.ok, false)
  assert.match(after.output, /requires HEALTH_CHECK_TOKEN but the secret sea-n-shore-staging\/health-check-token could not be read/)

  const short = run({ requires: true, secret: 'short' })
  assert.equal(short.ok, false)
  assert.match(short.output, /does not hold a usable token/)
  assert.doesNotMatch(short.output.replace('::add-mask::short', ''), /short(?! )/)

  // An extra header to an app that does not check it yet is harmless.
  const early = run({ requires: false, secret: TOKEN })
  assert.equal(early.ok, true, early.output)
  assert.equal(early.header, `x-health-check-token: ${TOKEN}\n`)
})

test('every workflow that calls /api/health/home sends the token header after configuring AWS credentials', () => {
  for (const [name, workflow, expectedCalls] of [['aws-remote-verify', remoteVerify, 1], ['aws-realtime-e2e', realtimeE2e, 2]]) {
    // Every curl of the deep health check, by literal path or through HOME_HEALTH_URL.
    const lines = workflow.split('\n')
    const calls = lines.map((line, index) => ({ line, index })).filter(({ line }) => /curl /.test(line) && /\/api\/health\/home|"\$HOME_HEALTH_URL"/.test(line))
    assert.equal(calls.length, expectedCalls, name)
    assert.equal(lines.filter((line) => line.includes('/api/health/home')).length, expectedCalls, `${name}: no other caller`)
    for (const { line, index } of calls) {
      const before = lines.slice(0, index).join('\n')
      const credentials = before.lastIndexOf('aws-actions/configure-aws-credentials@')
      const write = before.lastIndexOf('write_health_check_header "$HEALTH_HEADER_FILE"')
      assert.ok(credentials > 0 && write > credentials, `${name}: token read after the OIDC credentials`)
      assert.ok(before.lastIndexOf('source scripts/aws/health-check-token-header.sh') > credentials, name)
      assert.ok(before.lastIndexOf('- name:') < write, `${name}: header written in the same step as the call`)
      assert.match(line, /-H "@\$HEALTH_HEADER_FILE"/, name)
      assert.match(before.slice(write - 400), /trap 'rm -f -- "\$HEALTH_HEADER_FILE"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM/, name)
    }
    assert.doesNotMatch(workflow, /x-health-check-token: \$|HEALTH_CHECK_TOKEN=/, name)
  }
  assert.match(remoteVerify, /staging-http-health:\n\s+runs-on: ubuntu-latest\n\s+environment: staging/)
  assert.match(ci, /node --test scripts\/aws\/health-check-token\.test\.mjs/)
})
