// Round DB (owner-approved 11 Nov): the monitor job's stop rules, judged on the server side every minute.
// Stops when the last 3 one-minute values of any one of these are all over its limit:
//   - Aurora CPU (Maximum) at or above 90%;
//   - DB load (Performance Insights DBLoad, Average) at or above 1.5 sessions;
//   - ALB target response time p95 above 2 s.
// Aurora at its maximum ACU is no longer a stop (it is Aurora scaling up, not running out): the monitor logs it as
// information only. Fewer than 3 datapoints never stop.
//   node monitor-stop.mjs '{"cpu":[..],"dbLoad":[..],"p95":[..]}'   prints the reason and exits 0 to stop, else exits 1
import { pathToFileURL } from 'node:url'

export const MONITOR_RULES = [
  { key: 'cpu', limit: 90, holds: (v) => v >= 90, text: (v) => `Aurora CPU at or above 90% for 3 minutes (${v.join(', ')}%)` },
  { key: 'dbLoad', limit: 1.5, holds: (v) => v >= 1.5, text: (v) => `DB load at or above 1.5 sessions for 3 minutes (${v.join(', ')})` },
  { key: 'p95', limit: 2, holds: (v) => v > 2, text: (v) => `server-side p95 over 2 s for 3 minutes (${v.join(', ')} s)` },
]
export const MONITOR_MINUTES = 3

export function monitorStopReason(series) {
  for (const rule of MONITOR_RULES) {
    const values = Array.isArray(series?.[rule.key]) ? series[rule.key].map(Number).filter((v) => Number.isFinite(v)) : []
    if (values.length < MONITOR_MINUTES) continue
    const last = values.slice(-MONITOR_MINUTES)
    if (last.every(rule.holds)) return rule.text(last.map((v) => Math.round(v * 100) / 100))
  }
  return null
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let series = {}
  try { series = JSON.parse(process.argv[2] ?? '{}') } catch { series = {} }
  const reason = monitorStopReason(series)
  if (reason) process.stdout.write(`${reason}\n`)
  process.exit(reason ? 0 : 1)
}
