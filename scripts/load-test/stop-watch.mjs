// Round P3 load test: reads one shard's k6 CSV output (scripts/load-test/p3-load-test.js).
//
//   node stop-watch.mjs watch <csv> <k6-pid> <stop-file>   applies the stop rules while k6 runs
//   node stop-watch.mjs summarize <csv> <out.json>          writes the shard's per-step numbers for the report
//
// Stop rules, per step of the ramp, once that step has at least MIN_SAMPLES requests on this shard:
//   p95 over 2 s; server errors (5xx or no response) over 1%; WAF blocks (403/429) over 1%, which would make
//   the run measure the WAF instead of the site. On a stop it writes the reason to <stop-file> and sends k6 SIGINT
//   (k6 stops gracefully); the workflow then cancels the other shards.
import { appendFileSync, existsSync, readFileSync, statSync, openSync, readSync, closeSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const MIN_SAMPLES = 30
export const P95_LIMIT_MS = 2000
export const ERROR_LIMIT = 0.01

function splitCsv(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1 } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out
}

function tagsOf(extra) {
  const tags = {}
  for (const pair of String(extra || '').split('&')) {
    const at = pair.indexOf('=')
    if (at > 0) tags[pair.slice(0, at)] = pair.slice(at + 1)
  }
  return tags
}

/** Per-step accumulator fed with CSV lines (the first line must be the header). */
export function createStats() {
  let header = null
  const steps = new Map()
  const step = (n) => {
    if (!steps.has(n)) steps.set(n, { durations: [], ok: 0, server: 0, blocked: 0, other: 0, hits: 0, hitSamples: 0 })
    return steps.get(n)
  }
  return {
    steps,
    add(line) {
      if (!line) return
      const cells = splitCsv(line)
      if (!header) { header = Object.fromEntries(cells.map((name, i) => [name, i])); return }
      const metric = cells[header.metric_name]
      if (metric !== 'lt_req' && metric !== 'lt_hit') return
      const tags = tagsOf(cells[header.extra_tags])
      const n = Number(tags.step)
      if (!Number.isInteger(n) || n < 1) return
      const value = Number(cells[header.metric_value])
      const s = step(n)
      if (metric === 'lt_hit') { s.hitSamples += 1; s.hits += value ? 1 : 0; return }
      s.durations.push(Math.round(value))
      if (tags.cls === 'ok') s.ok += 1
      else if (tags.cls === '5xx' || tags.cls === 'neterr') s.server += 1
      else if (tags.cls === 'blocked') s.blocked += 1
      else s.other += 1
    },
  }
}

export function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
}

/** The first stop rule a step breaks, or null. Steps with fewer than MIN_SAMPLES requests are not judged yet. */
export function stopReason(steps) {
  for (const [n, s] of [...steps.entries()].sort((a, b) => a[0] - b[0])) {
    const count = s.durations.length
    if (count < MIN_SAMPLES) continue
    const p95 = percentile(s.durations, 95)
    if (p95 > P95_LIMIT_MS) return `step ${n}: p95 ${p95} ms over ${P95_LIMIT_MS} ms (${count} requests)`
    if (s.server / count > ERROR_LIMIT) return `step ${n}: server errors ${s.server}/${count} over 1%`
    if (s.blocked / count > ERROR_LIMIT) return `step ${n}: WAF blocks ${s.blocked}/${count} over 1%`
  }
  return null
}

export function summary(steps) {
  return [...steps.entries()].sort((a, b) => a[0] - b[0]).map(([n, s]) => ({
    step: n, requests: s.durations.length, ok: s.ok, server_errors: s.server, blocked: s.blocked, other: s.other,
    cache_hits: s.hits, cache_samples: s.hitSamples, durations_ms: s.durations,
  }))
}

function readAll(csv) {
  const stats = createStats()
  for (const line of readFileSync(csv, 'utf8').split('\n')) stats.add(line)
  return stats
}

async function watch(csv, pid, stopFile) {
  const stats = createStats()
  let offset = 0
  let rest = ''
  const alive = () => { try { process.kill(pid, 0); return true } catch { return false } }
  while (alive()) {
    await new Promise((resolve) => setTimeout(resolve, 5000))
    if (!existsSync(csv)) continue
    const size = statSync(csv).size
    if (size > offset) {
      const fd = openSync(csv, 'r')
      const buf = Buffer.alloc(size - offset)
      readSync(fd, buf, 0, buf.length, offset)
      closeSync(fd)
      offset = size
      const lines = (rest + buf.toString('utf8')).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) stats.add(line)
    }
    const reason = stopReason(stats.steps)
    if (reason) {
      writeFileSync(stopFile, `${reason}\n`)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY || '/dev/null', `LOAD_TEST_STOP ${reason}\n`)
      console.log(`LOAD_TEST_STOP ${reason}`)
      try { process.kill(pid, 'SIGINT') } catch { /* already gone */ }
      return
    }
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
const [mode, ...args] = isMain ? process.argv.slice(2) : []
if (mode === 'watch') await watch(args[0], Number(args[1]), args[2])
else if (mode === 'summarize') writeFileSync(args[1], JSON.stringify(summary(readAll(args[0]).steps)))
else if (mode) { console.error(`unknown mode ${mode}`); process.exit(2) }
