import { incrementRankingMetric } from './repository'

/**
 * Round CAP (batched impressions): every impressions request used to add its count to the same
 * ranking_metrics_daily row ((today, 'feed.impressions')), one upsert per request on one hot row. The count is now
 * summed in memory and written once a minute per task. A task that stops loses at most a minute of this daily
 * analytics count; the impressions themselves are written on every request as before.
 */
export const BUFFERED_METRIC_FLUSH_MS = 60_000

export function createBufferedMetric(input: {
  metric: string
  flushMs?: number
  write?: (metric: string, amount: number) => Promise<void>
  timers?: { setTimeout(callback: () => void, ms: number): unknown }
}) {
  const write = input.write ?? ((metric, amount) => incrementRankingMetric(metric, amount))
  const timers = input.timers ?? { setTimeout: (callback: () => void, ms: number) => {
    const handle = globalThis.setTimeout(callback, ms)
    ;(handle as { unref?: () => void }).unref?.()
    return handle
  } }
  let pending = 0
  let scheduled = false

  async function flush() {
    scheduled = false
    const amount = pending
    pending = 0
    if (amount > 0) await write(input.metric, amount)
  }

  return {
    add(amount: number) {
      if (!(amount > 0)) return
      pending += amount
      if (scheduled) return
      scheduled = true
      timers.setTimeout(() => { void flush() }, input.flushMs ?? BUFFERED_METRIC_FLUSH_MS)
    },
    flush,
    pending: () => pending,
  }
}

export const impressionsMetric = createBufferedMetric({ metric: 'feed.impressions' })
