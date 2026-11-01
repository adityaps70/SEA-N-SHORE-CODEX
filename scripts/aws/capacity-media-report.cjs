'use strict'
/* eslint-disable @typescript-eslint/no-require-imports */

// Round P3: runs the read-only capacity and media report on the bootstrap host through SSM, one
// section per command (config, usage, media) so each answer stays under the 24,000-character SSM
// output limit. The remote script only describes, gets and lists; see capacity-media-report-guard.test.mjs.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')

const instanceId = process.env.INSTANCE_ID
const region = process.env.AWS_REGION || 'ap-south-1'
assert.match(instanceId || '', /^i-[0-9a-f]+$/)

const remoteScript = readFileSync('scripts/aws/capacity-media-report-remote.py', 'utf8')
const encoded = Buffer.from(remoteScript, 'utf8').toString('base64')
const ALL_SECTIONS = ['config', 'usage', 'media']
// The load test (aws-load-test.yml) asks for the usage section over its own window only.
const SECTIONS = (process.env.REPORT_SECTIONS || ALL_SECTIONS.join(',')).split(',')
assert.ok(SECTIONS.length > 0 && SECTIONS.every((s) => ALL_SECTIONS.includes(s)), 'unknown report section')
const WINDOW = { start: process.env.REPORT_START || '', end: process.env.REPORT_END || '' }
for (const value of Object.values(WINDOW)) assert.match(value, /^$|^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/)
assert.ok(!WINDOW.start === !WINDOW.end, 'REPORT_START and REPORT_END go together')

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

async function runSection(section) {
  const remote = `set -euo pipefail
export AWS_REGION=${quote(region)}
export REPORT_SECTION=${quote(section)}
export REPORT_START=${quote(WINDOW.start)}
export REPORT_END=${quote(WINDOW.end)}
command -v python3 >/dev/null || { echo 'python3 is missing on the bootstrap host' >&2; exit 1; }
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
printf '%s' ${quote(encoded)} | base64 -d > "$WORK/report.py"
cd "$WORK"
python3 -I report.py
`
  const command = `runuser -u ssm-user -- bash -lc ${quote(remote)}`
  const parameters = JSON.stringify({ executionTimeout: ['3000'], commands: [command] })
  const sent = aws([
    'ssm', 'send-command',
    '--region', region,
    '--instance-ids', instanceId,
    '--document-name', 'AWS-RunShellScript',
    '--comment', `Sea N Shore read-only capacity and media report (${section})`,
    '--timeout-seconds', '600',
    '--parameters', parameters,
    '--query', 'Command.CommandId',
    '--output', 'text',
  ])
  const commandId = sent.stdout.trim()
  assert.match(commandId, /^[0-9a-f-]{36}$/)

  let invocation = null
  for (let attempt = 0; attempt < 1000; attempt += 1) {
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

  assert.ok(invocation, `Timed out waiting for the ${section} report`)
  process.stdout.write(`\n######## SECTION ${section} (${invocation.Status}) ########\n`)
  if (invocation.StandardOutputContent) process.stdout.write(invocation.StandardOutputContent)
  if (invocation.StandardErrorContent) process.stderr.write(invocation.StandardErrorContent.slice(-4000))
  return invocation.Status === 'Success'
}

;(async () => {
  let ok = true
  for (const section of SECTIONS) ok = (await runSection(section)) && ok
  assert.ok(ok, 'At least one report section did not finish; its partial output is above.')
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
