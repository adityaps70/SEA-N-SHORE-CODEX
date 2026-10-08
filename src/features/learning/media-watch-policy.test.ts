import { describe, expect, it } from 'vitest'
import { nextMediaProgress, seekLimit } from './media-watch-policy'

const fresh = { watchedSeconds: 0, furthestPositionSeconds: 0, lastPositionSeconds: 0, mediaPercent: 0 }

describe('media watch policy', () => {
  it('lets a learner seek forward only a few seconds past the furthest point reached', () => {
    expect(seekLimit(120)).toBe(125)
    expect(seekLimit(0)).toBe(5)
  })

  it('counts real watching towards completion', () => {
    const result = nextMediaProgress({
      stored: { ...fresh, watchedSeconds: 500, furthestPositionSeconds: 500, lastPositionSeconds: 500, mediaPercent: 83, secondsSinceLastSave: 60 },
      positionSeconds: 560,
      durationSeconds: 600,
      reportedWatchedSeconds: 560,
    })
    expect(result).toEqual({ positionSeconds: 560, watchedSeconds: 560, furthestPositionSeconds: 560, mediaPercent: 93 })
  })

  it('does not complete a video by jumping to the end', () => {
    const result = nextMediaProgress({
      stored: { ...fresh, watchedSeconds: 30, furthestPositionSeconds: 30, lastPositionSeconds: 30, mediaPercent: 5, secondsSinceLastSave: 10 },
      positionSeconds: 595,
      durationSeconds: 600,
      reportedWatchedSeconds: 600,
    })
    // At most 2 × 10 s + 20 s of new viewing in 10 seconds of real time.
    expect(result).toEqual({ positionSeconds: 70, watchedSeconds: 70, furthestPositionSeconds: 70, mediaPercent: 11 })
  })

  it('does not complete a video by replaying its first minute', () => {
    const result = nextMediaProgress({
      stored: { ...fresh, watchedSeconds: 540, furthestPositionSeconds: 60, lastPositionSeconds: 60, mediaPercent: 10, secondsSinceLastSave: 60 },
      positionSeconds: 60,
      durationSeconds: 600,
      reportedWatchedSeconds: 600,
    })
    expect(result.mediaPercent).toBe(10)
  })

  it('never lowers progress already recorded, and lets a learner rewatch freely', () => {
    const result = nextMediaProgress({
      stored: { watchedSeconds: 0, furthestPositionSeconds: 0, lastPositionSeconds: 400, mediaPercent: 70, secondsSinceLastSave: 5 },
      positionSeconds: 100,
      durationSeconds: 600,
      reportedWatchedSeconds: 15,
    })
    // Older progress (before this rule) counts as reached up to its saved position.
    expect(result).toEqual({ positionSeconds: 100, watchedSeconds: 15, furthestPositionSeconds: 400, mediaPercent: 70 })
  })

  it('infers watched time from forward progress for older players that do not report it', () => {
    const result = nextMediaProgress({
      stored: { ...fresh, watchedSeconds: 100, furthestPositionSeconds: 100, lastPositionSeconds: 100, mediaPercent: 16, secondsSinceLastSave: 15 },
      positionSeconds: 115,
      durationSeconds: 600,
    })
    expect(result).toMatchObject({ watchedSeconds: 115, furthestPositionSeconds: 115, mediaPercent: 19 })
  })

  it('always gives whole seconds (the progress columns are integers)', () => {
    const result = nextMediaProgress({
      stored: { ...fresh, watchedSeconds: 15, furthestPositionSeconds: 15, lastPositionSeconds: 15, mediaPercent: 2, secondsSinceLastSave: 5.0013 },
      positionSeconds: 598.7,
      durationSeconds: 600.4,
      reportedWatchedSeconds: 598.2,
    })
    for (const value of Object.values(result)) expect(Number.isInteger(value)).toBe(true)
  })
})
