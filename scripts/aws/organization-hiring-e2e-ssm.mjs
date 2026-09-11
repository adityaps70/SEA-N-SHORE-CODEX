import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const phase = process.argv[2]
const allowedPhases = new Set(['confirm', 'grant-admin', 'resolve-application', 'verify-approval', 'resolve-job', 'verify-unauthorized', 'cleanup'])
assert.ok(allowedPhases.has(phase), `Unsupported SSM E2E phase: ${phase}`)

const instanceId = process.env.INSTANCE_ID
assert.match(instanceId ?? '', /^i-[0-9a-f]+$/)

const remoteScript = readFileSync('scripts/aws/organization-hiring-e2e-remote.sh', 'utf8')
const encoded = Buffer.from(remoteScript, 'utf8').toString('base64')
const forwarded = [
  'AWS_REGION',
  'COGNITO_POOL_NAME',
  'E2E_APPLICANT_EMAIL',
  'E2E_ADMIN_EMAIL',
  'E2E_UNAUTHORIZED_EMAIL',
  'E2E_ORGANIZATION_NAME',
  'E2E_JOB_TITLE',
  'E2E_APPLICATION_ID',
  'E2E_COMPANY_ID',
  'E2E_JOB_ID',
]

function quote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`
}

const exports = forwarded
  .filter((name) => process.env[name])
  .map((name) => `export ${name}=${quote(process.env[name])}`)
  .join('\n')

const remote = `set -euo pipefail
${exports}
printf '%s' ${quote(encoded)} | base64 -d > /tmp/organization-hiring-e2e-remote.sh
chmod 700 /tmp/organization-hiring-e2e-remote.sh
/tmp/organization-hiring-e2e-remote.sh ${quote(phase)}
`
const command = `runuser -u ssm-user -- bash -lc ${quote(remote)}`
const parameters = JSON.stringify({ executionTimeout: ['600'], commands: [command] })

function aws(args, { allowFailure = false } = {}) {
  const result = spawnSync('aws', args, { encoding: 'utf8', env: process.env })
  if (!allowFailure && result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `AWS CLI failed: ${args.join(' ')}\n`)
    process.exit(result.status || 1)
  }
  return result
}

const sent = aws([
  'ssm', 'send-command',
  '--region', process.env.AWS_REGION || 'ap-south-1',
  '--instance-ids', instanceId,
  '--document-name', 'AWS-RunShellScript',
  '--comment', `Sea N Shore organization hiring E2E ${phase} ${process.env.GITHUB_SHA || ''}`,
  '--timeout-seconds', '600',
  '--parameters', parameters,
  '--query', 'Command.CommandId',
  '--output', 'text',
])
const commandId = sent.stdout.trim()
assert.match(commandId, /^[0-9a-f-]{36}$/)

let invocation = null
for (let attempt = 0; attempt < 200; attempt += 1) {
  const result = aws([
    'ssm', 'get-command-invocation',
    '--region', process.env.AWS_REGION || 'ap-south-1',
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

assert.ok(invocation, `Timed out waiting for SSM phase ${phase}`)
if (invocation.StandardOutputContent) process.stdout.write(invocation.StandardOutputContent)
if (invocation.StandardErrorContent) process.stderr.write(invocation.StandardErrorContent)
assert.equal(invocation.Status, 'Success', `SSM phase ${phase} ended with ${invocation.Status}`)
