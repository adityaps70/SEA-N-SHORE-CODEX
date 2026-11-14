import { describe, expect, it, vi } from 'vitest'
import { BUFFERED_METRIC_FLUSH_MS, createBufferedMetric } from './buffered-metric'

/** Round CAP: the impressions count is summed in memory and written once a minute, never per request. */
describe('createBufferedMetric', () => {
  it('sums requests and writes once per minute, nothing when there is nothing to add', async () => {
    const callbacks: Array<() => void> = []
    const write = vi.fn(async () => {})
    const metric = createBufferedMetric({ metric: 'feed.impressions', write, timers: { setTimeout: (callback, ms) => { expect(ms).toBe(BUFFERED_METRIC_FLUSH_MS); callbacks.push(callback) } } })
    metric.add(3)
    metric.add(0)
    metric.add(5)
    expect(callbacks).toHaveLength(1)
    expect(write).not.toHaveBeenCalled()
    callbacks[0]!()
    await Promise.resolve()
    expect(write).toHaveBeenCalledWith('feed.impressions', 8)
    expect(metric.pending()).toBe(0)
    metric.add(2)
    expect(callbacks).toHaveLength(2)
    callbacks[1]!()
    await Promise.resolve()
    expect(write).toHaveBeenLastCalledWith('feed.impressions', 2)
    await metric.flush()
    expect(write).toHaveBeenCalledTimes(2)
  })
})
