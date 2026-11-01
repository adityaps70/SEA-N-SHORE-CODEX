// Round ARCH (Phase 1), stop rule 3: exits 0 (stop) when the last 5 one-minute maximums of Aurora capacity are all at
// the cluster's maximum ACU, and 1 otherwise (including when there are fewer than 5 datapoints).
//   node aurora-stop.mjs '[2,2,2,2,2]' 2
import { pathToFileURL } from 'node:url'

export function auroraAtMax(values, maxAcu) {
  return Array.isArray(values) && values.length >= 5 && values.slice(-5).every((value) => Number(value) >= maxAcu)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let values = []
  try { values = JSON.parse(process.argv[2] ?? '[]') } catch { values = [] }
  process.exit(auroraAtMax(values, Number(process.argv[3])) ? 0 : 1)
}
