'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')

const instanceId = process.env.INSTANCE_ID
const marker = process.env.HIRING_CREATE_JOB_PROBE_MARKER
const region = process.env.AWS_REGION || 'ap-south-1'
assert.match(instanceId || '', /^i-[0-9a-f]+$/)
assert.match(marker || '', /^[0-9]+$/)

const remoteScript = readFileSync('scripts/aws/hiring-create-job-probe-remote.sh', 'utf8')
const encoded = Buffer.from(remoteScript, 'utf8').toString('base64')

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

const remote = `set -euo pipefail
export AWS_REGION=${quote(region)}
export HIRING_CREATE_JOB_PROBE_MARKER=${quote(marker)}
printf '%s' ${quote(encoded)} | base64 -d > /tmp/hiring-create-job-probe-remote.sh
chmod 700 /tmp/hiring-create-job-probe-remote.sh
/tmp/hiring-create-job-probe-remote.sh
rm -f /tmp/hiring-create-job-probe-remote.sh
`
const command = `runuser -u ssm-user -- bash -lc ${quote(remote)}`
const parameters = JSON.stringify({ executionTimeout: ['600'], commands: [command] })

const sent = aws([
  'ssm', 'send-command',
  '--region', region,
  '--instance-ids', instanceId,
  '--document-name', 'AWS-RunShellScript',
  '--comment', `Sea N Shore hiring create-job rollback probe ${process.env.GITHUB_SHA || ''}`,
  '--timeout-seconds', '600',
  '--parameters', parameters,
  '--query', 'Command.CommandId',
  '--output', 'text',
])
const commandId = sent.stdout.trim()
assert.match(commandId, /^[0-9a-f-]{36}$/)

let invocation = null
;(async () => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = aws([
      'ssm', 'get-command-invocation',
      '--region', region,
      '--command-id', commandId,
      '--instance-id', instanceId,
      '--output', 'json',
    ], { allowFailure: true })
    if (result.status === 0) {
      const current = JSON.parse(result.stdout)
      if (!['Pending', 'InProgress', 'Delayed'].includes(current.Status)) {
        invocation = current
        break
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }

  assert.ok(invocation, 'Timed out waiting for hiring create-job probe')
  if (invocation.StandardOutputContent) process.stdout.write(invocation.StandardOutputContent)
  if (invocation.StandardErrorContent) process.stderr.write(invocation.StandardErrorContent)
  assert.equal(invocation.Status, 'Success', `Hiring create-job probe ended with ${invocation.Status}`)
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
