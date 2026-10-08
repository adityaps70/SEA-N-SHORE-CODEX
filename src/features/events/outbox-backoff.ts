// Round 14 (3.10): how long the outbox worker sleeps after a batch. Work keeps it looping
// immediately; an idle poll backs off from 5 s, doubling up to 10 s, with a little jitter so
// several worker tasks do not poll Aurora in lockstep.
export const OUTBOX_IDLE_BASE_MS = 5_000
export const OUTBOX_IDLE_MAX_MS = 10_000
export const OUTBOX_IDLE_JITTER_MS = 500

/**
 * @param consecutiveIdleBatches batches in a row (including this one) that claimed nothing; 0 when
 *   the latest batch claimed work.
 * @param random a [0, 1) source, injectable for tests.
 */
export function outboxIdleDelayMs(consecutiveIdleBatches: number, random: () => number = Math.random) {
  if (!Number.isFinite(consecutiveIdleBatches) || consecutiveIdleBatches <= 0) return 0
  const exponent = Math.min(Math.floor(consecutiveIdleBatches) - 1, 8)
  const base = Math.min(OUTBOX_IDLE_BASE_MS * 2 ** exponent, OUTBOX_IDLE_MAX_MS - OUTBOX_IDLE_JITTER_MS)
  const sample = random()
  const unit = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 0.999) : 0
  const jitter = Math.floor(unit * OUTBOX_IDLE_JITTER_MS)
  // 5.0-5.5 s after the first idle batch, then 9.5-10 s: always within 5-10 s.
  return base + jitter
}
