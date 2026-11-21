import { describe, expect, it } from 'vitest'
import { createMetricBatch, type MetricIncrement } from './metric-batch'

function harness(maxKeys?: number) {
  const writes: MetricIncrement[][] = []
  const timers: Array<() => void> = []
  const batch = createMetricBatch({
    write: async (increments) => { writes.push(increments.map((i) => ({ ...i }))) },
    setTimer: (callback) => { timers.push(callback) },
    maxKeys,
  })
  return { batch, writes, timers }
}

describe('metric batch (owner 18 Nov, fix 3d)', () => {
  it('sums increments per metric and member and writes them once, a minute after the first', async () => {
    const h = harness()
    h.batch.add('pymk.lists_shown', 1, 'member-1')
    h.batch.add('pymk.lists_shown', 1, 'member-1')
    h.batch.add('pymk.lists_shown', 1, 'member-2')
    h.batch.add('feed.top_pages', 2, null)
    h.batch.add('feed.top_pages', 0, null)
    expect(h.writes).toEqual([])
    expect(h.timers).toHaveLength(1)
    h.timers[0]!()
    await Promise.resolve()
    expect(h.writes).toEqual([[
      { metric: 'pymk.lists_shown', amount: 2, actorProfileId: 'member-1' },
      { metric: 'pymk.lists_shown', amount: 1, actorProfileId: 'member-2' },
      { metric: 'feed.top_pages', amount: 2, actorProfileId: null },
    ]])
    // Nothing held: the next increment starts a new minute.
    h.batch.add('feed.top_pages', 1, null)
    expect(h.timers).toHaveLength(2)
  })

  it('writes early when it holds too many pairs, and a failed write never throws to the caller', async () => {
    const h = harness(3)
    h.batch.add('a', 1, 'm1')
    h.batch.add('a', 1, 'm2')
    h.batch.add('a', 1, 'm3')
    await Promise.resolve()
    expect(h.writes).toHaveLength(1)
    expect(h.batch.pendingKeys()).toBe(0)
    const failing = createMetricBatch({ write: async () => { throw new Error('down') }, setTimer: () => undefined, onError: () => undefined })
    failing.add('a', 1, null)
    await expect(failing.flush()).resolves.toBeUndefined()
  })
})
