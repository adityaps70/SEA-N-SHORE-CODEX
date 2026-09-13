import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const phase = process.argv[2]
const allowed = new Set(['confirm', 'prepare', 'verify-durable', 'verify-infra', 'cleanup', 'diagnose-connect'])
assert.ok(allowed.has(phase), `Unsupported Realtime E2E SSM phase: ${phase}`)
const instanceId = process.env.INSTANCE_ID
assert.match(instanceId ?? '', /^i-[0-9a-f]+$/)

const remoteScript = readFileSync('scripts/aws/realtime-e2e-remote.sh', 'utf8')
const encoded = Buffer.from(remoteScript).toString('base64')
const forwarded = [
  'AWS_REGION', 'COGNITO_POOL_NAME', 'E2E_SENDER_EMAIL', 'E2E_RECIPIENT_EMAIL',
  'E2E_CONVERSATION_ID', 'E2E_MESSAGE_BODY', 'E2E_INJECTED_BODY', 'E2E_RUN_STARTED_AT',
  'E2E_DIAGNOSTIC_START_MS', 'E2E_DIAGNOSTIC_END_MS',
]
const quote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`
const exports = forwarded
  .filter((name) => process.env[name])
  .map((name) => `export ${name}=${quote(process.env[name])}`)
  .join('\n')
const remote = `set -euo pipefail\n${exports}\nprintf '%s' ${quote(encoded)} | base64 -d > /tmp/realtime-e2e-remote.sh\nchmod 700 /tmp/realtime-e2e-remote.sh\n/tmp/realtime-e2e-remote.sh ${quote(phase)}\n`
const command = `runuser -u ssm-user -- bash -lc ${quote(remote)}`
const parameters = JSON.stringify({ executionTimeout: ['600'], commands: [command] })

function aws(args, allowFailure = false) {
  const result = spawnSync('aws', args, { encoding: 'utf8', env: process.env })
  if (!allowFailure && result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `AWS CLI failed: ${args.join(' ')}\n`)
    process.exit(result.status || 1)
  }
  return result
}

const region = process.env.AWS_REGION || 'ap-south-1'
const sent = aws([
  'ssm', 'send-command', '--region', region, '--instance-ids', instanceId,
  '--document-name', 'AWS-RunShellScript', '--comment', `Sea N Shore Realtime E2E ${phase} ${process.env.GITHUB_SHA || ''}`,
  '--timeout-seconds', '600', '--parameters', parameters, '--query', 'Command.CommandId', '--output', 'text',
])
const commandId = sent.stdout.trim()
assert.match(commandId, /^[0-9a-f-]{36}$/)
let invocation = null
for (let attempt = 0; attempt < 200; attempt += 1) {
  const result = aws([
    'ssm', 'get-command-invocation', '--region', region, '--command-id', commandId,
    '--instance-id', instanceId, '--output', 'json',
  ], true)
  if (result.status === 0) {
    const current = JSON.parse(result.stdout)
    if (!['Pending', 'InProgress', 'Delayed'].includes(current.Status)) {
      invocation = current
      break
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 3000))
}
assert.ok(invocation, `Timed out waiting for Realtime E2E SSM phase ${phase}`)
if (invocation.StandardOutputContent) process.stdout.write(invocation.StandardOutputContent)
if (invocation.StandardErrorContent) process.stderr.write(invocation.StandardErrorContent)
assert.equal(invocation.Status, 'Success', `Realtime E2E SSM phase ${phase} ended with ${invocation.Status}`)
