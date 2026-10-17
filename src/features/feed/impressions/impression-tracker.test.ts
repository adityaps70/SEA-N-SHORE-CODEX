import { describe, expect, it, vi } from 'vitest'
import {
  IMPRESSION_BATCH_LIMIT,
  IMPRESSION_DWELL_MS,
  IMPRESSION_FLUSH_MS,
  IMPRESSION_MAX_FAILURES,
  IMPRESSION_MAX_WAIT_MS,
  IMPRESSION_RETRY_BASE_MS,
  IMPRESSION_RETRY_MAX_MS,
  ImpressionTracker,
  classifyImpressionResponse,
  impressionRetryDelay,
  parseRetryAfter,
  type ImpressionSendResult,
  type ImpressionTransport,
} from './impression-tracker'

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
      const target = clock + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        clock = due[1].at
        due[1].callback()
      }
      clock = target
    },
    pending() {
      return timers.size
    },
  }
}

function transport(results: ImpressionSendResult[] | ImpressionSendResult = { outcome: 'sent' }) {
  const sent: string[][] = []
  const beaconed: string[][] = []
  const queue = Array.isArray(results) ? [...results] : null
  const value: ImpressionTransport = {
    send: vi.fn(async (ids: string[]): Promise<ImpressionSendResult> => {
      sent.push(ids)
      return queue ? (queue.shift() ?? { outcome: 'sent' }) : (results as ImpressionSendResult)
    }),
    beacon: vi.fn((ids: string[]) => {
      beaconed.push(ids)
      return true
    }),
  }
  return { value, sent, beaconed }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function see(tracker: ImpressionTracker, clock: ReturnType<typeof fakeTimers>, ...ids: string[]) {
  for (const id of ids) tracker.visibility(id, 1)
  clock.advance(IMPRESSION_DWELL_MS)
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

  it('sends one batch per scroll window, once scrolling pauses, and each post once', async () => {
    const clock = fakeTimers()
    const { value, sent } = transport()
    const tracker = new ImpressionTracker(value, clock.timers)

    // Scrolling: a new post is seen every 2 s, so the quiet period keeps restarting.
    see(tracker, clock, 'a')
    clock.advance(2000)
    see(tracker, clock, 'b')
    clock.advance(2000)
    see(tracker, clock, 'c')
    expect(sent).toEqual([])
    clock.advance(IMPRESSION_FLUSH_MS)
    await vi.waitFor(() => expect(sent).toEqual([['a', 'b', 'c']]))

    see(tracker, clock, 'a')
    clock.advance(IMPRESSION_FLUSH_MS)
    await settle()
    expect(sent).toHaveLength(1)
  })

  it('still sends during non-stop scrolling, at the latest after the max wait', async () => {
    const clock = fakeTimers()
    const { value, sent } = transport()
    const tracker = new ImpressionTracker(value, clock.timers)

    for (let index = 0; index < 12; index += 1) {
      see(tracker, clock, `p${index}`)
      clock.advance(IMPRESSION_FLUSH_MS - IMPRESSION_DWELL_MS - 100)
    }
    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(1))
    expect(sent.length).toBeLessThanOrEqual(Math.ceil((12 * (IMPRESSION_FLUSH_MS - 100)) / IMPRESSION_MAX_WAIT_MS))
  })

  it('sends right away when a batch is full', async () => {
    const clock = fakeTimers()
    const { value, sent } = transport()
    const tracker = new ImpressionTracker(value, clock.timers)
    see(tracker, clock, ...Array.from({ length: IMPRESSION_BATCH_LIMIT }, (_, index) => `p${index}`))
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toHaveLength(IMPRESSION_BATCH_LIMIT)
  })

  it('flushes what was seen just before a reload with sendBeacon (pagehide)', () => {
    const clock = fakeTimers()
    const { value, sent, beaconed } = transport()
    const tracker = new ImpressionTracker(value, clock.timers)

    see(tracker, clock, 'a')
    // The member reloads 1.2 s after the post appeared: before the batch.
    tracker.flushWithBeacon()

    expect(beaconed).toEqual([['a']])
    expect(sent).toEqual([])
    clock.advance(IMPRESSION_MAX_WAIT_MS)
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

  it('backs off exponentially on errors instead of retrying in a tight loop', async () => {
    const clock = fakeTimers()
    const { value, sent } = transport({ outcome: 'retry' })
    const tracker = new ImpressionTracker(value, clock.timers)

    see(tracker, clock, 'a')
    clock.advance(IMPRESSION_FLUSH_MS)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(tracker.pendingIds()).toEqual(['a'])

    // Nothing for the first 10 s, even when more posts are seen meanwhile.
    see(tracker, clock, 'b')
    clock.advance(IMPRESSION_RETRY_BASE_MS - IMPRESSION_DWELL_MS - 1)
    await settle()
    expect(sent).toHaveLength(1)
    clock.advance(1)
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[1]).toEqual(['a', 'b'])

    // Then 20 s.
    clock.advance(IMPRESSION_RETRY_BASE_MS * 2 - 1)
    await settle()
    expect(sent).toHaveLength(2)
    clock.advance(1)
    await vi.waitFor(() => expect(sent).toHaveLength(3))
  })

  it('gives up after repeated failures, so a failing server sees a handful of calls per page', async () => {
    const clock = fakeTimers()
    const { value, sent } = transport({ outcome: 'retry' })
    const onStop = vi.fn()
    const tracker = new ImpressionTracker(value, clock.timers, onStop)

    see(tracker, clock, 'a')
    for (let step = 0; step < 20; step += 1) {
      clock.advance(IMPRESSION_RETRY_MAX_MS)
      await settle()
    }
    expect(sent).toHaveLength(IMPRESSION_MAX_FAILURES)
    expect(tracker.isStopped()).toBe(true)
    expect(onStop).toHaveBeenCalledWith('failing')

    see(tracker, clock, 'z')
    tracker.flushWithBeacon()
    clock.advance(IMPRESSION_RETRY_MAX_MS)
    await settle()
    expect(sent).toHaveLength(IMPRESSION_MAX_FAILURES)
    expect(clock.pending()).toBe(0)
  })

  it('honours Retry-After when it is longer than the backoff', async () => {
    const clock = fakeTimers()
    const { value, sent } = transport([{ outcome: 'retry', retryAfterMs: 60_000 }])
    const tracker = new ImpressionTracker(value, clock.timers)

    see(tracker, clock, 'a')
    clock.advance(IMPRESSION_FLUSH_MS)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    clock.advance(59_999)
    await settle()
    expect(sent).toHaveLength(1)
    clock.advance(1)
    await vi.waitFor(() => expect(sent).toHaveLength(2))
  })

  it('stops for the page on 401 or 403 and does not beacon afterwards', async () => {
    const clock = fakeTimers()
    const { value, sent, beaconed } = transport({ outcome: 'stop' })
    const onStop = vi.fn()
    const tracker = new ImpressionTracker(value, clock.timers, onStop)

    see(tracker, clock, 'a')
    clock.advance(IMPRESSION_FLUSH_MS)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(onStop).toHaveBeenCalledWith('refused')
    see(tracker, clock, 'b')
    tracker.flushWithBeacon()
    clock.advance(IMPRESSION_RETRY_MAX_MS)
    await settle()
    expect(sent).toHaveLength(1)
    expect(beaconed).toEqual([])
  })

  it('does not beacon while backing off', async () => {
    const clock = fakeTimers()
    const { value, sent, beaconed } = transport({ outcome: 'retry' })
    const tracker = new ImpressionTracker(value, clock.timers)
    see(tracker, clock, 'a')
    clock.advance(IMPRESSION_FLUSH_MS)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    tracker.flushWithBeacon()
    expect(beaconed).toEqual([])
  })
})

describe('impression responses', () => {
  it('classifies statuses', () => {
    expect(classifyImpressionResponse(204, null)).toEqual({ outcome: 'sent' })
    expect(classifyImpressionResponse(400, null)).toEqual({ outcome: 'drop' })
    expect(classifyImpressionResponse(401, null)).toEqual({ outcome: 'stop' })
    expect(classifyImpressionResponse(403, null)).toEqual({ outcome: 'stop' })
    expect(classifyImpressionResponse(429, '30')).toEqual({ outcome: 'retry', retryAfterMs: 30_000 })
    expect(classifyImpressionResponse(503, null)).toEqual({ outcome: 'retry', retryAfterMs: undefined })
  })

  it('reads Retry-After as seconds or a date', () => {
    expect(parseRetryAfter('120')).toBe(120_000)
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6_000)
    expect(parseRetryAfter('soon')).toBeUndefined()
    expect(parseRetryAfter(null)).toBeUndefined()
  })

  it('grows the delay and caps it', () => {
    expect(impressionRetryDelay(1)).toBe(IMPRESSION_RETRY_BASE_MS)
    expect(impressionRetryDelay(2)).toBe(IMPRESSION_RETRY_BASE_MS * 2)
    expect(impressionRetryDelay(20)).toBe(IMPRESSION_RETRY_MAX_MS)
    expect(impressionRetryDelay(1, 90_000)).toBe(90_000)
  })
})
