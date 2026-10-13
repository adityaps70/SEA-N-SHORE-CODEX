import { describe, expect, it, vi } from 'vitest'
import { IMPRESSION_DWELL_MS, IMPRESSION_FLUSH_MS, ImpressionTracker, type ImpressionTransport } from './impression-tracker'

function fakeTimers() {
  let clock = 0
  const timers = new Map<number, { at: number; callback: () => void }>()
  let next = 1
  return {
    timers: {
      setTimeout(callback: () => void, ms: number) {
        const id = next++
        timers.set(id, { at: clock + ms, callback })
        return id
      },
      clearTimeout(handle: unknown) {
        timers.delete(handle as number)
      },
    },
    advance(ms: number) {
      clock += ms
      for (const [id, timer] of [...timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= clock && timers.has(id)) {
          timers.delete(id)
          timer.callback()
        }
      }
    },
  }
}

function transport(ok = true) {
  const sent: string[][] = []
  const beaconed: string[][] = []
  const value: ImpressionTransport = {
    send: vi.fn(async (ids: string[]) => {
      sent.push(ids)
      return ok
    }),
    beacon: vi.fn((ids: string[]) => {
      beaconed.push(ids)
      return true
    }),
  }
  return { value, sent, beaconed }
}

describe('ImpressionTracker', () => {
  it('counts a post only after half of it is visible for a full second', () => {
    const clock = fakeTimers()
    const { value } = transport()
    const tracker = new ImpressionTracker(value, clock.timers)

    tracker.visibility('a', 0.4)
    clock.advance(IMPRESSION_DWELL_MS * 2)
    expect(tracker.pendingIds()).toEqual([])

    tracker.visibility('a', 0.6)
    clock.advance(IMPRESSION_DWELL_MS - 1)
    tracker.visibility('a', 0.2)
    clock.advance(IMPRESSION_DWELL_MS)
    expect(tracker.pendingIds()).toEqual([])

    tracker.visibility('a', 0.9)
    clock.advance(IMPRESSION_DWELL_MS)
    expect(tracker.pendingIds()).toEqual(['a'])
  })

  it('batches seen posts and sends them about every 5 seconds, each once', async () => {
    const clock = fakeTimers()
    const { value, sent } = transport()
    const tracker = new ImpressionTracker(value, clock.timers)

    tracker.visibility('a', 1)
    tracker.visibility('b', 1)
    clock.advance(IMPRESSION_DWELL_MS)
    expect(sent).toEqual([])
    clock.advance(IMPRESSION_FLUSH_MS)
    await vi.waitFor(() => expect(sent).toEqual([['a', 'b']]))

    tracker.visibility('a', 1)
    clock.advance(IMPRESSION_DWELL_MS)
    clock.advance(IMPRESSION_FLUSH_MS)
    expect(sent).toHaveLength(1)
  })

  it('flushes what was seen just before a reload with sendBeacon (pagehide)', () => {
    const clock = fakeTimers()
    const { value, sent, beaconed } = transport()
    const tracker = new ImpressionTracker(value, clock.timers)

    tracker.visibility('a', 1)
    clock.advance(IMPRESSION_DWELL_MS)
    // The member reloads 1.2 s after the post appeared: before the 5 s batch.
    tracker.flushWithBeacon()

    expect(beaconed).toEqual([['a']])
    expect(sent).toEqual([])
    clock.advance(IMPRESSION_FLUSH_MS)
    expect(sent).toEqual([])
  })

  it('does not count a post that was visible for less than a second before the reload', () => {
    const clock = fakeTimers()
    const { value, beaconed } = transport()
    const tracker = new ImpressionTracker(value, clock.timers)

    tracker.visibility('a', 1)
    clock.advance(IMPRESSION_DWELL_MS / 2)
    tracker.flushWithBeacon()
    expect(beaconed).toEqual([])
  })

  it('keeps ids and retries when a batch fails', async () => {
    const clock = fakeTimers()
    const { value, sent } = transport(false)
    const tracker = new ImpressionTracker(value, clock.timers)

    tracker.visibility('a', 1)
    clock.advance(IMPRESSION_DWELL_MS)
    clock.advance(IMPRESSION_FLUSH_MS)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(tracker.pendingIds()).toEqual(['a'])
  })
})
