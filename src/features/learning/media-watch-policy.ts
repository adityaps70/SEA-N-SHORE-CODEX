/**
 * Video and audio progress from real viewing (learning round A, A7).
 *
 * - A learner can always seek back, and forward only up to the furthest point they actually
 *   reached plus a few seconds (SEEK_AHEAD_SECONDS). Rewatching is never punished.
 * - Completion counts real watched time: the share of the media both watched (playback time) and
 *   reached (furthest point), so skipping ahead or replaying the first minute doesn't complete it.
 * - The server trusts the player only as far as the clock allows: new watched time and a new
 *   furthest point can grow by at most twice the time since the last save (2x is the fastest
 *   speed) plus a little slack.
 */

export const SEEK_AHEAD_SECONDS = 5
export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const
const MAX_RATE = 2
const SLACK_SECONDS = 20

/** The furthest a learner may seek, given how far they have reached. */
export function seekLimit(furthestSeconds: number) {
  return Math.max(0, furthestSeconds) + SEEK_AHEAD_SECONDS
}

export type StoredMediaProgress = {
  watchedSeconds: number
  furthestPositionSeconds: number
  lastPositionSeconds: number
  mediaPercent: number
  /** Seconds since this progress was last saved; null when there is no saved progress yet. */
  secondsSinceLastSave: number | null
}

export function nextMediaProgress(input: {
  stored: StoredMediaProgress | null
  positionSeconds: number
  durationSeconds: number
  /** Playback time the player counted for this material (all sessions); absent from older players. */
  reportedWatchedSeconds?: number
}) {
  const stored = input.stored ?? { watchedSeconds: 0, furthestPositionSeconds: 0, lastPositionSeconds: 0, mediaPercent: 0, secondsSinceLastSave: null }
  const duration = Math.max(0, input.durationSeconds)
  const position = Math.max(0, Math.floor(input.positionSeconds))
  // Whole seconds: the progress columns are integers.
  const allowance = Math.floor(Math.max(0, stored.secondsSinceLastSave ?? 0) * MAX_RATE) + SLACK_SECONDS
  // Older players report no watched time: count the forward progress since the last save instead.
  const reported = input.reportedWatchedSeconds ?? stored.watchedSeconds + Math.max(0, position - stored.lastPositionSeconds)
  const watchedGain = Math.min(Math.max(0, Math.floor(reported) - stored.watchedSeconds), allowance)
  const watchedSeconds = Math.min(stored.watchedSeconds + watchedGain, duration > 0 ? Math.ceil(duration) : Number.MAX_SAFE_INTEGER)
  // Earlier progress (before this rule) counts as reached up to its saved position.
  const reachedBefore = Math.max(stored.furthestPositionSeconds, stored.lastPositionSeconds)
  const furthestPositionSeconds = Math.max(reachedBefore, Math.min(position, reachedBefore + allowance))
  const covered = Math.min(watchedSeconds, furthestPositionSeconds)
  const viewedPercent = duration > 0 ? Math.max(0, Math.min(100, Math.floor((covered / duration) * 100))) : 0
  return {
    // The resume point is never beyond what was reached, so a forged position can't move it ahead.
    positionSeconds: Math.min(position, furthestPositionSeconds),
    watchedSeconds,
    furthestPositionSeconds,
    // Progress already recorded is never lowered.
    mediaPercent: Math.max(stored.mediaPercent, viewedPercent),
  }
}
