/**
 * Owner (18 Nov, fix 3d): the daily admin metrics (ranking_metrics_daily) were one upsert per increment: about 12,000
 * in 9 minutes of the 18 Nov load test, all on a few hot rows (the /network page alone writes 12 per view). Increments
 * are now summed in memory per (metric, member) and written once a minute per server in one statement, which still
 * leaves out load-test accounts in SQL exactly as before. A server that stops loses at most a minute of these counts
 * (as with feed.impressions since Round CAP); nothing a member sees depends on them.
 */
export const METRIC_BATCH_FLUSH_MS = 60_000
/** Distinct (metric, member) pairs held before an early write, so memory stays small under any load. */
export const METRIC_BATCH_MAX_KEYS = 2_000

export type MetricIncrement = { metric: string; amount: number; actorProfileId: string | null }

export function createMetricBatch(input: {
  write: (increments: MetricIncrement[]) => Promise<void>
  flushMs?: number
  maxKeys?: number
  setTimer?: (callback: () => void, ms: number) => unknown
  onError?: (error: unknown) => void
}) {
  const setTimer = input.setTimer ?? ((callback: () => void, ms: number) => {
    const handle = globalThis.setTimeout(callback, ms)
    ;(handle as { unref?: () => void }).unref?.()
    return handle
  })
  const onError = input.onError ?? ((error: unknown) => {
    console.warn('[ranking_metric_batch_failed]', { code: (error as { code?: string })?.code ?? null })
  })
  let pending = new Map<string, MetricIncrement>()
  let scheduled = false

  async function flush() {
    scheduled = false
    if (pending.size === 0) return
    const increments = [...pending.values()]
    pending = new Map()
    try {
      await input.write(increments)
    } catch (error) {
      onError(error)
    }
  }

  return {
    add(metric: string, amount: number, actorProfileId: string | null) {
      if (!(amount > 0)) return
      const key = `${metric}\u0000${actorProfileId ?? ''}`
      const existing = pending.get(key)
      if (existing) existing.amount += amount
      else pending.set(key, { metric, amount, actorProfileId })
      if (pending.size >= (input.maxKeys ?? METRIC_BATCH_MAX_KEYS)) {
        void flush()
        return
      }
      if (scheduled) return
      scheduled = true
      setTimer(() => { void flush() }, input.flushMs ?? METRIC_BATCH_FLUSH_MS)
    },
    flush,
    pendingKeys: () => pending.size,
  }
}
