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
const MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/
const isoMinute = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')

// Round ARCH (Phase 5 measurement): the committed window file either reads "none" (the full report) or
// "compare <start> <end|now> [split <time>]": then only the compare section runs, over start..end and the same hours
// 24 hours earlier. "now" is the run's start less 10 minutes (ALB logs arrive every 5 minutes); the window is capped
// at 24 hours so the two never overlap.
function compareWindow() {
  const line = readFileSync('scripts/aws/capacity-media-report-window.txt', 'utf8').trim()
  if (line === 'none') return null
  // Round ARCH: read-only pre-checks before a rollout step (section_checks in the remote script).
  if (line === 'checks') return { checks: true }
  const m = line.match(/^compare (\S+) (\S+)(?: split (\S+))?$/)
  assert.ok(m && MINUTE.test(m[1]) && (m[2] === 'now' || MINUTE.test(m[2])) && (!m[3] || MINUTE.test(m[3])),
    'the window file must read "none" or "compare <start> <end|now> [split <time>]" in whole UTC minutes')
  const start = new Date(m[1])
  let end = m[2] === 'now' ? new Date(Math.floor((Date.now() - 10 * 60_000) / 60_000) * 60_000) : new Date(m[2])
  end = new Date(Math.min(end.getTime(), start.getTime() + 24 * 3600_000))
  assert.ok(end > start, 'the compare window ends before it starts')
  if (m[3]) assert.ok(new Date(m[3]) > start && new Date(m[3]) < end, 'the split must fall inside the compare window')
  return { start: m[1], end: isoMinute(end), split: m[3] || '' }
}

// The load test (aws-load-test.yml) asks for the usage section over its own window only; it never runs the compare.
const COMPARE = process.env.REPORT_SECTIONS ? null : compareWindow()
// The public site's host, for the checks section (the live edge check probes the organization whose website is this).
const SITE_HOST = (readFileSync('scripts/aws/public-site-url.txt', 'utf8').trim().match(/^https:\/\/([a-z0-9.-]+)$/) || [])[1] || ''

const SECTIONS = COMPARE?.checks ? ['checks'] : COMPARE ? ['compare'] : (process.env.REPORT_SECTIONS || ALL_SECTIONS.join(',')).split(',')
assert.ok(SECTIONS.length > 0 && SECTIONS.every((s) => ALL_SECTIONS.includes(s) || (COMPARE && s === (COMPARE.checks ? 'checks' : 'compare'))), 'unknown report section')
const WINDOW = { start: process.env.REPORT_START || '', end: process.env.REPORT_END || '' }
for (const value of Object.values(WINDOW)) assert.ok(value === '' || MINUTE.test(value), 'REPORT_START and REPORT_END are whole UTC minutes')
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
export COMPARE_START=${quote(COMPARE?.start ?? '')}
export COMPARE_END=${quote(COMPARE?.end ?? '')}
export COMPARE_SPLIT=${quote(COMPARE?.split ?? '')}
export REPORT_SITE_HOST=${quote(SITE_HOST)}
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
