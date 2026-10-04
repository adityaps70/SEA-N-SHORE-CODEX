import { describe, expect, it } from 'vitest'
import { OUTBOX_IDLE_BASE_MS, OUTBOX_IDLE_MAX_MS, outboxIdleDelayMs } from './outbox-backoff'

describe('outbox idle backoff', () => {
  it('loops immediately while batches claim work', () => {
    expect(outboxIdleDelayMs(0)).toBe(0)
    expect(outboxIdleDelayMs(-1)).toBe(0)
    expect(outboxIdleDelayMs(Number.NaN)).toBe(0)
  })

  it('waits 5 s after the first idle batch, then up to 10 s, with jitter only inside 5-10 s', () => {
    expect(outboxIdleDelayMs(1, () => 0)).toBe(5_000)
    expect(outboxIdleDelayMs(1, () => 0.999)).toBe(5_499)
    expect(outboxIdleDelayMs(2, () => 0)).toBe(9_500)
    expect(outboxIdleDelayMs(2, () => 0.5)).toBe(9_750)
    expect(outboxIdleDelayMs(1_000, () => 0.999)).toBe(9_999)
    for (const idle of [1, 2, 3, 10, 1_000_000]) {
      for (const sample of [0, 0.25, 0.5, 0.9999, 1, 7, -3, Number.NaN]) {
        const delay = outboxIdleDelayMs(idle, () => sample)
        expect(delay).toBeGreaterThanOrEqual(OUTBOX_IDLE_BASE_MS)
        expect(delay).toBeLessThanOrEqual(OUTBOX_IDLE_MAX_MS)
      }
    }
  })

  it('never decreases as the idle streak grows', () => {
    let previous = 0
    for (let idle = 1; idle <= 20; idle += 1) {
      const delay = outboxIdleDelayMs(idle, () => 0)
      expect(delay).toBeGreaterThanOrEqual(previous)
      previous = delay
    }
  })
})
