'use strict'
/* eslint-disable @typescript-eslint/no-require-imports */

// Round P3: runs the read-only capacity and media report on the bootstrap host through SSM, one
// section per command (config, usage, media) so each answer stays under the 24,000-character SSM
// output limit. The remote script only describes, gets and lists; see capacity-media-report-guard.test.mjs.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { gzipSync } = require('node:zlib')

const instanceId = process.env.INSTANCE_ID
const region = process.env.AWS_REGION || 'ap-south-1'
assert.match(instanceId || '', /^i-[0-9a-f]+$/)

const remoteScript = readFileSync('scripts/aws/capacity-media-report-remote.py', 'utf8')
// Round DB: gzipped before base64. Plain base64 of the script passed SSM's 97 KB command limit
// (run 43017998127, MaxDocumentSizeExceeded); gzip brings it to about a quarter.
const encoded = gzipSync(Buffer.from(remoteScript, 'utf8'), { level: 9 }).toString('base64')
assert.ok(encoded.length < 60_000, 'the encoded report script must stay well under the 97 KB SSM limit')
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
  // Round DB: where the database time goes and what the stack costs, with Performance Insights over one load test
  // window (under 3 hours): "db <start> <end>". Runs the config, db, dbwindow, dbminutes, dbstats, dbplans, dbhealth and cost
  // sections.
  const db = line.match(/^db (\S+) (\S+)$/)
  if (db) {
    assert.ok(MINUTE.test(db[1]) && MINUTE.test(db[2]) && new Date(db[2]) > new Date(db[1]) &&
      new Date(db[2]) - new Date(db[1]) <= 3 * 3600_000, 'the db window must be "db <start> <end>", under 3 hours, in whole UTC minutes')
    return { db: true, runStart: db[1], runEnd: db[2] }
  }
  // Round CAP Step 0 (owner 13 Nov): requests per active signed-in person-minute by type, writes in the window and
  // the 7-day top statements, real traffic only (the load tests are left out): "cap <start> <end>", at most 14 days.
  const cap = line.match(/^cap (\S+) (\S+)$/)
  if (cap) {
    assert.ok(MINUTE.test(cap[1]) && MINUTE.test(cap[2]) && new Date(cap[2]) > new Date(cap[1]) &&
      new Date(cap[2]) - new Date(cap[1]) <= 14 * 24 * 3600_000, 'the cap window must be "cap <start> <end>", at most 14 days, in whole UTC minutes')
    return { cap: true, capStart: cap[1], capEnd: cap[2] }
  }
  // Round CAP (owner 13 Nov): the admin final-reminder counts split at the Deploy B deploy and at the 10-second limit:
  // "legacy <start> <deploy B> <time limit> <end>", at most 8 days, in whole UTC minutes.
  const legacy = line.match(/^legacy (\S+) (\S+) (\S+) (\S+)$/)
  if (legacy) {
    const points = legacy.slice(1)
    assert.ok(points.every((p) => MINUTE.test(p)) && points.every((p, i) => i === 0 || new Date(p) > new Date(points[i - 1])) &&
      new Date(points[3]) - new Date(points[0]) <= 8 * 24 * 3600_000, 'the legacy window must be "legacy <start> <split> <split> <end>", in order, at most 8 days')
    return { legacy: true, legacyPoints: points.join(',') }
  }
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
// The organization the live edge check probes (scripts/aws/org-page-edge-check.sh), for the checks section.
const PROBE_ORG_NAME = readFileSync('scripts/aws/org-page-probe-name.txt', 'utf8').trim()
assert.ok(PROBE_ORG_NAME && PROBE_ORG_NAME.length <= 120 && !/["\\]/.test(PROBE_ORG_NAME), 'org-page-probe-name.txt must hold one organization name')

const DB_SECTIONS = ['config', 'db', 'dbwindow', 'dbminutes', 'edgeminutes', 'dbstats', 'dbplans', 'dbhealth', 'cost']
// Round DB (Option A): the compare window also prints the database cost per request (dbcompare).
const CAP_SECTIONS = ['capminutes', 'capwrites', 'cap7d']
const SECTIONS = COMPARE?.legacy ? ['legacysplit'] : COMPARE?.cap ? CAP_SECTIONS : COMPARE?.db ? DB_SECTIONS : COMPARE?.checks ? ['checks'] : COMPARE ? ['compare', 'dbcompare'] : (process.env.REPORT_SECTIONS || ALL_SECTIONS.join(',')).split(',')
assert.ok(SECTIONS.length > 0 && SECTIONS.every((s) => ALL_SECTIONS.includes(s) || (COMPARE?.db && DB_SECTIONS.includes(s)) ||
  (COMPARE?.cap && CAP_SECTIONS.includes(s)) || (COMPARE?.legacy && s === 'legacysplit') ||
  (COMPARE && !COMPARE.db && !COMPARE.cap && !COMPARE.legacy && (COMPARE.checks ? s === 'checks' : ['compare', 'dbcompare'].includes(s)))), 'unknown report section')
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
export DB_RUN_START=${quote(COMPARE?.runStart ?? '')}
export DB_RUN_END=${quote(COMPARE?.runEnd ?? '')}
export CAP_START=${quote(COMPARE?.capStart ?? '')}
export CAP_END=${quote(COMPARE?.capEnd ?? '')}
export LEGACY_POINTS=${quote(COMPARE?.legacyPoints ?? '')}
export REPORT_PROBE_ORG_NAME=${quote(PROBE_ORG_NAME)}
export LOAD_TEST_STEP_RPM=${quote(/^[0-9,]*$/.test(process.env.LOAD_TEST_STEP_RPM || '') ? process.env.LOAD_TEST_STEP_RPM || '' : '')}
command -v python3 >/dev/null || { echo 'python3 is missing on the bootstrap host' >&2; exit 1; }
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
printf '%s' ${quote(encoded)} | base64 -d | gunzip > "$WORK/report.py"
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
