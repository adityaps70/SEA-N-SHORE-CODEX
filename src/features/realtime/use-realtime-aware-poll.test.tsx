import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Round ARCH (Phase 5): the timer stops while the realtime socket carries the check, comes back (with one catch-up
 * check) when the socket drops, and a reconnect after a drop runs one catch-up check. Hints run the check within 2 s.
 */
const realtime = vi.hoisted(() => ({
  status: 'disconnected' as string,
  listeners: new Set<(signal: { eventType: string }) => void>(),
  present: true,
}))
vi.mock('./provider', () => ({
  useOptionalMessagingRealtime: () => realtime.present
    ? { status: realtime.status, subscribe: (listener: (signal: { eventType: string }) => void) => { realtime.listeners.add(listener); return () => realtime.listeners.delete(listener) } }
    : null,
}))

const { REALTIME_HINT_DEBOUNCE_MS, useRealtimeAwarePoll } = await import('./use-realtime-aware-poll')

const INTERVAL = 60_000
function Probe({ check, pause = true }: { check: () => void; pause?: boolean }) {
  useRealtimeAwarePoll(check, { intervalMs: INTERVAL, hintEventTypes: ['feed.post_created'], pauseWhileConnected: pause })
  return null
}
const hint = (eventType: string) => act(() => { for (const listener of realtime.listeners) listener({ eventType }) })

beforeEach(() => {
  vi.useFakeTimers()
  realtime.status = 'disconnected'
  realtime.listeners.clear()
  realtime.present = true
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useRealtimeAwarePoll', () => {
  it('polls while the socket is down and stops while it is connected; the first connect is not a catch-up', async () => {
    const check = vi.fn()
    const view = render(<Probe check={check} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL) })
    expect(check).toHaveBeenCalledTimes(1)

    realtime.status = 'connected'
    view.rerender(<Probe check={check} />)
    expect(check).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL * 5) })
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('catches up once when the socket drops and once when it comes back, then follows the hints', async () => {
    const check = vi.fn()
    realtime.status = 'connected'
    const view = render(<Probe check={check} />)
    expect(check).not.toHaveBeenCalled()

    realtime.status = 'backoff'
    view.rerender(<Probe check={check} />)
    expect(check).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL) })
    expect(check).toHaveBeenCalledTimes(2)

    realtime.status = 'connected'
    view.rerender(<Probe check={check} />)
    expect(check).toHaveBeenCalledTimes(3)
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL * 3) })
    expect(check).toHaveBeenCalledTimes(3)

    hint('feed.post_reaction_changed')
    hint('feed.post_created')
    hint('feed.post_created')
    await act(async () => { await vi.advanceTimersByTimeAsync(REALTIME_HINT_DEBOUNCE_MS) })
    expect(check).toHaveBeenCalledTimes(4)
  })

  it('keeps the timer when hints cannot cover the check, and works without any realtime provider', async () => {
    const check = vi.fn()
    realtime.status = 'connected'
    render(<Probe check={check} pause={false} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL) })
    expect(check).toHaveBeenCalledTimes(1)
    cleanup()

    realtime.present = false
    const signedOut = vi.fn()
    render(<Probe check={signedOut} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL) })
    expect(signedOut).toHaveBeenCalledTimes(1)
  })

  it('stretches the timer while connected for a check the hints cover only in part (Round CAP finding 5)', async () => {
    const check = vi.fn()
    function Stretch() {
      useRealtimeAwarePoll(check, { intervalMs: INTERVAL, connectedIntervalMs: INTERVAL * 5, hintEventTypes: ['feed.post_created'], pauseWhileConnected: false })
      return null
    }
    realtime.status = 'connected'
    const view = render(<Stretch />)
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL * 4) })
    expect(check).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL) })
    expect(check).toHaveBeenCalledTimes(1)
    // Hints still check at once.
    hint('feed.post_created')
    await act(async () => { await vi.advanceTimersByTimeAsync(REALTIME_HINT_DEBOUNCE_MS) })
    expect(check).toHaveBeenCalledTimes(2)
    // Socket down: back to the normal timer.
    realtime.status = 'backoff'
    view.rerender(<Stretch />)
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL) })
    expect(check).toHaveBeenCalledTimes(3)
  })
})
