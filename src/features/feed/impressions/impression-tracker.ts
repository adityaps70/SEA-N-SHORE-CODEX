/**
 * Round G (G0.2): decides when a post counts as seen and ships the ids to /api/feed/impressions.
 *
 * - Seen = at least half of the post visible for at least 1 second.
 * - Round H (H1): one call per scroll window. Ids go out once scrolling has paused for
 *   IMPRESSION_FLUSH_MS, and at the latest IMPRESSION_MAX_WAIT_MS after the first one was queued, or
 *   right away when a batch is full.
 * - On pagehide or when the tab is hidden, whatever is queued goes with navigator.sendBeacon, so a
 *   refresh or reload never loses what was just seen.
 * - Each post is sent once per page load; the server also caps rows at one update per hour.
 * - Round H (H1): errors back off. A retryable failure (network, 408, 429, 5xx) waits 10 s, then
 *   20 s, 40 s… up to 5 minutes, or longer when the server sends Retry-After. After
 *   IMPRESSION_MAX_FAILURES failures in a row, or on 401/403, the tracker stops for this page.
 *   It never retries on a short fixed timer.
 *
 * - Round CAP: a post that finishes its dwell while the tab is hidden is not counted, and drain() sends
 *   everything queued at once (a new feed visit calls it first, so the server knows what was seen).
 *
 * Plain class with injected timers and transport, so it can be tested without a browser.
 */
export const IMPRESSION_ENDPOINT = '/api/feed/impressions'
export const IMPRESSION_VISIBLE_RATIO = 0.5
export const IMPRESSION_DWELL_MS = 1000
// Round CAP (batched impressions, owner-approved 13 Nov): one call per 15-30 s of scrolling instead of 5-15 s.
export const IMPRESSION_FLUSH_MS = 15_000
export const IMPRESSION_MAX_WAIT_MS = 30_000
/** Round CAP: how long a new feed visit waits for the queued ids to reach the server before it asks for posts. */
export const IMPRESSION_DRAIN_WAIT_MS = 1500
export const IMPRESSION_BATCH_LIMIT = 50
export const IMPRESSION_RETRY_BASE_MS = 10_000
export const IMPRESSION_RETRY_MAX_MS = 5 * 60_000
export const IMPRESSION_MAX_FAILURES = 5

/**
 * - sent: stored; the ids are done.
 * - drop: this batch will never be accepted (400); forget it and carry on.
 * - stop: nothing more will be accepted on this page (401 signed out, 403 refused).
 * - retry: try the same ids again later (network error, 408, 429, 5xx).
 */
export type ImpressionSendResult =
  | { outcome: 'sent' | 'drop' | 'stop' }
  | { outcome: 'retry'; retryAfterMs?: number }

export type ImpressionTransport = {
  /** Normal batched send. */
  send(postIds: string[]): Promise<ImpressionSendResult>
  /** Last-chance send on pagehide / hidden; must not wait for a response. */
  beacon(postIds: string[]): boolean
}

type Timers = {
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export function impressionRetryDelay(failures: number, retryAfterMs?: number) {
  const backoff = Math.min(IMPRESSION_RETRY_BASE_MS * 2 ** Math.max(0, failures - 1), IMPRESSION_RETRY_MAX_MS)
  return Math.max(backoff, retryAfterMs && Number.isFinite(retryAfterMs) ? Math.min(retryAfterMs, 60 * 60_000) : 0)
}

export class ImpressionTracker {
  private readonly dwellTimers = new Map<string, unknown>()
  private readonly queued = new Set<string>()
  private readonly sent = new Set<string>()
  private quietTimer: unknown = null
  private maxWaitTimer: unknown = null
  private retryTimer: unknown = null
  private sending = false
  private sendingDone: Promise<void> | null = null
  private failures = 0
  private stopped = false

  constructor(
    private readonly transport: ImpressionTransport,
    private readonly timers: Timers = { setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms), clearTimeout: (handle) => globalThis.clearTimeout(handle as number) },
    /** Told once when the tracker gives up, so the next page does not start hammering again. */
    private readonly onStop?: (reason: 'refused' | 'failing') => void,
    /** Round CAP: true while the tab is hidden; nothing seen then is counted. */
    private readonly isHidden: () => boolean = () => false,
  ) {}

  /** Called with each post's current visible ratio (from an IntersectionObserver). */
  visibility(postId: string, ratio: number) {
    if (this.stopped || this.sent.has(postId) || this.queued.has(postId)) return
    if (ratio >= IMPRESSION_VISIBLE_RATIO && !this.isHidden()) {
      if (this.dwellTimers.has(postId)) return
      this.dwellTimers.set(postId, this.timers.setTimeout(() => {
        this.dwellTimers.delete(postId)
        this.markSeen(postId)
      }, IMPRESSION_DWELL_MS))
      return
    }
    this.cancelDwell(postId)
  }

  /** A post left the page (unmounted): a dwell that has not finished does not count. */
  forget(postId: string) {
    this.cancelDwell(postId)
  }

  pendingIds() {
    return [...this.queued]
  }

  /** True after 401/403 or too many failures in a row: nothing more is sent from this page. */
  isStopped() {
    return this.stopped
  }

  /** Normal batched send. */
  async flush() {
    this.clearWindowTimers()
    if (this.stopped || this.sending || this.retryTimer !== null || !this.queued.size) return
    const ids = [...this.queued].slice(0, IMPRESSION_BATCH_LIMIT)
    this.sending = true
    let done: () => void = () => {}
    this.sendingDone = new Promise<void>((resolve) => { done = resolve })
    for (const id of ids) this.queued.delete(id)
    let result: ImpressionSendResult
    try {
      result = await this.transport.send(ids)
    } catch {
      result = { outcome: 'retry' }
    }
    this.sending = false
    this.sendingDone = null
    done()

    if (result.outcome === 'sent' || result.outcome === 'drop') {
      this.failures = 0
      for (const id of ids) this.sent.add(id)
      if (this.queued.size >= IMPRESSION_BATCH_LIMIT) void this.flush()
      else if (this.queued.size) this.scheduleWindow()
      return
    }
    if (result.outcome === 'stop') {
      this.stop('refused')
      return
    }

    this.failures += 1
    if (this.failures >= IMPRESSION_MAX_FAILURES) {
      this.stop('failing')
      return
    }
    for (const id of ids) this.queued.add(id)
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null
      void this.flush()
    }, impressionRetryDelay(this.failures, result.outcome === 'retry' ? result.retryAfterMs : undefined))
  }

  /**
   * Round CAP: send everything queued now and wait for the server (a new feed visit, which must not show what was
   * just seen). Gives up quietly while backing off or stopped; the queued ids then go with the retry.
   */
  async drain() {
    for (let round = 0; round < 10; round += 1) {
      if (this.sendingDone) {
        await this.sendingDone
        continue
      }
      if (this.stopped || this.retryTimer !== null || !this.queued.size) return
      await this.flush()
    }
  }

  /** pagehide / visibilitychange → hidden: everything queued goes now, without waiting. */
  flushWithBeacon() {
    // While the server is failing, a beacon would only add load; those ids wait for the retry.
    if (this.stopped || this.retryTimer !== null || !this.queued.size) return
    this.clearWindowTimers()
    const ids = [...this.queued]
    for (let start = 0; start < ids.length; start += IMPRESSION_BATCH_LIMIT) {
      const batch = ids.slice(start, start + IMPRESSION_BATCH_LIMIT)
      if (this.transport.beacon(batch)) {
        for (const id of batch) {
          this.queued.delete(id)
          this.sent.add(id)
        }
      }
    }
  }

  dispose() {
    for (const handle of this.dwellTimers.values()) this.timers.clearTimeout(handle)
    this.dwellTimers.clear()
    this.clearWindowTimers()
    this.clearRetryTimer()
  }

  private stop(reason: 'refused' | 'failing') {
    this.stopped = true
    this.queued.clear()
    this.dispose()
    this.onStop?.(reason)
  }

  private markSeen(postId: string) {
    // Round CAP: a dwell that ends while the tab is hidden does not count (nobody was looking).
    if (this.stopped || this.sent.has(postId) || this.isHidden()) return
    this.queued.add(postId)
    // Backing off: the queued id goes with the retry.
    if (this.retryTimer !== null) return
    if (this.queued.size >= IMPRESSION_BATCH_LIMIT) {
      void this.flush()
      return
    }
    this.scheduleWindow()
  }

  private cancelDwell(postId: string) {
    const handle = this.dwellTimers.get(postId)
    if (handle === undefined) return
    this.timers.clearTimeout(handle)
    this.dwellTimers.delete(postId)
  }

  /** Restart the quiet timer on every newly seen post; the max-wait timer runs from the first one. */
  private scheduleWindow() {
    if (this.quietTimer !== null) this.timers.clearTimeout(this.quietTimer)
    this.quietTimer = this.timers.setTimeout(() => {
      this.quietTimer = null
      void this.flush()
    }, IMPRESSION_FLUSH_MS)
    if (this.maxWaitTimer === null) {
      this.maxWaitTimer = this.timers.setTimeout(() => {
        this.maxWaitTimer = null
        void this.flush()
      }, IMPRESSION_MAX_WAIT_MS)
    }
  }

  private clearWindowTimers() {
    if (this.quietTimer !== null) this.timers.clearTimeout(this.quietTimer)
    if (this.maxWaitTimer !== null) this.timers.clearTimeout(this.maxWaitTimer)
    this.quietTimer = null
    this.maxWaitTimer = null
  }

  private clearRetryTimer() {
    if (this.retryTimer === null) return
    this.timers.clearTimeout(this.retryTimer)
    this.retryTimer = null
  }
}

/** Seconds or an HTTP date, as Retry-After allows; undefined when absent or unreadable. */
export function parseRetryAfter(value: string | null, now = Date.now()) {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined
}

export function classifyImpressionResponse(status: number, retryAfter: string | null): ImpressionSendResult {
  if (status >= 200 && status < 300) return { outcome: 'sent' }
  if (status === 401 || status === 403) return { outcome: 'stop' }
  if (status === 408 || status === 429 || status >= 500) return { outcome: 'retry', retryAfterMs: parseRetryAfter(retryAfter) }
  return { outcome: 'drop' }
}

/** The browser transport: fetch with keepalive for batches, sendBeacon on the way out. */
export function browserImpressionTransport(endpoint = IMPRESSION_ENDPOINT): ImpressionTransport {
  return {
    async send(postIds) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ postIds }),
          credentials: 'same-origin',
          keepalive: true,
        })
        return classifyImpressionResponse(response.status, response.headers.get('retry-after'))
      } catch {
        return { outcome: 'retry' }
      }
    },
    beacon(postIds) {
      const body = JSON.stringify({ postIds })
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        return navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))
      }
      void fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' }).catch(() => undefined)
      return true
    },
  }
}
