// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startVisibleInterval } from './visible-interval'

let visibility: DocumentVisibilityState = 'visible'

function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('startVisibleInterval (Round P3)', () => {
  it('ticks while visible, makes no calls while hidden, and catches up once when shown again', () => {
    const tick = vi.fn()
    const stop = startVisibleInterval(tick, 60_000)

    vi.advanceTimersByTime(60_000)
    expect(tick).toHaveBeenCalledTimes(1)

    setVisibility('hidden')
    vi.advanceTimersByTime(10 * 60_000)
    expect(tick).toHaveBeenCalledTimes(1)

    setVisibility('visible')
    expect(tick).toHaveBeenCalledTimes(2)
    stop()
    vi.advanceTimersByTime(10 * 60_000)
    setVisibility('hidden')
    setVisibility('visible')
    expect(tick).toHaveBeenCalledTimes(2)
  })

  it('does not run early when a tab is shown again before a tick is due', () => {
    const tick = vi.fn()
    startVisibleInterval(tick, 60_000)
    vi.advanceTimersByTime(20_000)
    setVisibility('hidden')
    setVisibility('visible')
    expect(tick).not.toHaveBeenCalled()
  })
})
