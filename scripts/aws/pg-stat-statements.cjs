'use strict'
/* eslint-disable @typescript-eslint/no-require-imports */

// Round P3 (B9): runs scripts/aws/pg-stat-statements-remote.py on the bootstrap host through SSM.
// PGSS_ACTION=install creates the extension when Aurora already preloads it; anything else only reads.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')

const instanceId = process.env.INSTANCE_ID
const region = process.env.AWS_REGION || 'ap-south-1'
const action = process.env.PGSS_ACTION === 'install' ? 'install' : 'check'
assert.match(instanceId || '', /^i-[0-9a-f]+$/)

const encoded = Buffer.from(readFileSync('scripts/aws/pg-stat-statements-remote.py', 'utf8'), 'utf8').toString('base64')

function quote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`
}

function aws(args, { allowFailure = false } = {}) {
  const result = spawnSync('aws', args, { encoding: 'utf8', env: process.env })
  if (!allowFailure && result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `AWS CLI failed: ${args.join(' ')}\n`)
    process.exit(result.status || 1)
  }
  return result
}

;(async () => {
  const remote = `set -euo pipefail
export AWS_REGION=${quote(region)}
export PGSS_ACTION=${quote(action)}
command -v python3 >/dev/null || { echo 'python3 is missing on the bootstrap host' >&2; exit 1; }
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
printf '%s' ${quote(encoded)} | base64 -d > "$WORK/pgss.py"
cd "$WORK"
python3 -I pgss.py
`
  const command = `runuser -u ssm-user -- bash -lc ${quote(remote)}`
  const sent = aws([
    'ssm', 'send-command',
    '--region', region,
    '--instance-ids', instanceId,
    '--document-name', 'AWS-RunShellScript',
    '--comment', `Sea N Shore pg_stat_statements (${action})`,
    '--timeout-seconds', '600',
    '--parameters', JSON.stringify({ executionTimeout: ['600'], commands: [command] }),
    '--query', 'Command.CommandId',
    '--output', 'text',
  ])
  const commandId = sent.stdout.trim()
  assert.match(commandId, /^[0-9a-f-]{36}$/)
  let invocation = null
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = aws(['ssm', 'get-command-invocation', '--region', region, '--command-id', commandId, '--instance-id', instanceId, '--output', 'json'], { allowFailure: true })
    if (result.status === 0) {
      const current = JSON.parse(result.stdout)
      if (!['Pending', 'InProgress', 'Delayed'].includes(current.Status)) {
        invocation = current
        break
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  assert.ok(invocation, 'Timed out waiting for pg_stat_statements')
  if (invocation.StandardOutputContent) process.stdout.write(invocation.StandardOutputContent)
  if (invocation.StandardErrorContent) process.stderr.write(invocation.StandardErrorContent.slice(-4000))
  assert.equal(invocation.Status, 'Success', 'pg_stat_statements did not finish (PGSS_REBOOT_REQUIRED means nothing changed)')
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
