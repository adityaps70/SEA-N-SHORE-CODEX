// Round P3 load test: merges the shards' per-step numbers (stop-watch.mjs summarize) into one report.
//   node report.mjs <dir-with-shard-json> <total-rpm-csv> <step-seconds> [stop-reason-file...]
// Prints aggregate numbers only: no URLs, ids or member data.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ERROR_LIMIT, MIN_SAMPLES, P95_LIMIT_MS, percentile } from './stop-watch.mjs'

export function mergeShards(shards) {
  const steps = new Map()
  for (const shard of shards) {
    for (const s of shard) {
      const m = steps.get(s.step) ?? { requests: 0, ok: 0, server_errors: 0, blocked: 0, other: 0, cache_hits: 0, cache_samples: 0, durations: [] }
      for (const key of ['requests', 'ok', 'server_errors', 'blocked', 'other', 'cache_hits', 'cache_samples']) m[key] += s[key]
      m.durations.push(...s.durations_ms)
      steps.set(s.step, m)
    }
  }
  return steps
}

export function reportLines(steps, totalRpm, stepSeconds, stops = []) {
  const lines = []
  const pct = (a, b) => (b ? ((100 * a) / b).toFixed(2) : '0.00')
  let passed = 0
  let failedAt = null
  for (const [n, m] of [...steps.entries()].sort((a, b) => a[0] - b[0])) {
    const p95 = percentile(m.durations, 95)
    const ok = m.requests >= MIN_SAMPLES && p95 <= P95_LIMIT_MS && m.server_errors / m.requests <= ERROR_LIMIT && m.blocked / m.requests <= ERROR_LIMIT
    lines.push([
      `LOAD_TEST_STEP step=${n}`, `target_rpm=${totalRpm[n - 1] ?? '?'}`,
      `achieved_rpm=${Math.round(m.requests / (stepSeconds / 60))}`, `requests=${m.requests}`,
      `p50_ms=${percentile(m.durations, 50)}`, `p95_ms=${p95}`, `p99_ms=${percentile(m.durations, 99)}`,
      `server_error_pct=${pct(m.server_errors, m.requests)}`, `waf_block_pct=${pct(m.blocked, m.requests)}`,
      `other_4xx_pct=${pct(m.other, m.requests)}`, `edge_cache_hit_pct=${pct(m.cache_hits, m.cache_samples)}`,
      `within_limits=${ok}`,
    ].join(' '))
    if (ok && failedAt === null) passed = n
    else if (failedAt === null) failedAt = n
  }
  const reasons = [...new Set(stops.map((s) => s.trim()).filter(Boolean))]
  lines.push(`LOAD_TEST_RESULT highest_step_within_limits=${passed} highest_rpm_within_limits=${passed ? totalRpm[passed - 1] : 0} stopped=${reasons.length > 0}`)
  for (const reason of reasons) lines.push(`LOAD_TEST_STOP_REASON ${reason}`)
  return lines
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
const [dir, rpmCsv, stepSeconds, ...stopFiles] = isMain ? process.argv.slice(2) : []
if (dir) {
  const shards = readdirSync(dir, { recursive: true }).filter((name) => String(name).endsWith('.json')).map((name) => JSON.parse(readFileSync(join(dir, String(name)), 'utf8')))
  const stops = stopFiles.filter((f) => existsSync(f)).map((f) => readFileSync(f, 'utf8'))
  console.log(`LOAD_TEST_SHARDS_REPORTED=${shards.length}`)
  for (const line of reportLines(mergeShards(shards), rpmCsv.split(',').map(Number), Number(stepSeconds), stops)) console.log(line)
}
