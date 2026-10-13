/**
 * Round G (G0.2): decides when a post counts as seen and ships the ids to /api/feed/impressions.
 *
 * - Seen = at least half of the post visible for at least 1 second.
 * - Ids are batched and sent about every 5 seconds (fetch with keepalive).
 * - On pagehide or when the tab is hidden, whatever is queued goes with navigator.sendBeacon, so a
 *   refresh or reload never loses what was just seen.
 * - Each post is sent once per page load; the server also caps rows at one update per hour.
 *
 * Plain class with injected timers and transport, so it can be tested without a browser.
 */
export const IMPRESSION_ENDPOINT = '/api/feed/impressions'
export const IMPRESSION_VISIBLE_RATIO = 0.5
export const IMPRESSION_DWELL_MS = 1000
export const IMPRESSION_FLUSH_MS = 5000
export const IMPRESSION_BATCH_LIMIT = 50

export type ImpressionTransport = {
  /** Normal batched send; resolves false when it failed and the ids should be retried. */
  send(postIds: string[]): Promise<boolean>
  /** Last-chance send on pagehide / hidden; must not wait for a response. */
  beacon(postIds: string[]): boolean
}

type Timers = {
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export class ImpressionTracker {
  private readonly dwellTimers = new Map<string, unknown>()
  private readonly queued = new Set<string>()
  private readonly sent = new Set<string>()
  private flushTimer: unknown = null
  private sending = false

  constructor(
    private readonly transport: ImpressionTransport,
    private readonly timers: Timers = { setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms), clearTimeout: (handle) => globalThis.clearTimeout(handle as number) },
  ) {}

  /** Called with each post's current visible ratio (from an IntersectionObserver). */
  visibility(postId: string, ratio: number) {
    if (this.sent.has(postId) || this.queued.has(postId)) return
    if (ratio >= IMPRESSION_VISIBLE_RATIO) {
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

  /** Normal batched send. */
  async flush() {
    this.clearFlushTimer()
    if (this.sending || !this.queued.size) return
    const ids = [...this.queued].slice(0, IMPRESSION_BATCH_LIMIT)
    this.sending = true
    for (const id of ids) this.queued.delete(id)
    let ok = false
    try {
      ok = await this.transport.send(ids)
    } catch {
      ok = false
    }
    this.sending = false
    if (ok) {
      for (const id of ids) this.sent.add(id)
    } else {
      for (const id of ids) this.queued.add(id)
    }
    if (this.queued.size) this.scheduleFlush()
  }

  /** pagehide / visibilitychange → hidden: everything queued goes now, without waiting. */
  flushWithBeacon() {
    this.clearFlushTimer()
    if (!this.queued.size) return
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
    this.clearFlushTimer()
  }

  private markSeen(postId: string) {
    if (this.sent.has(postId)) return
    this.queued.add(postId)
    if (this.queued.size >= IMPRESSION_BATCH_LIMIT) {
      void this.flush()
      return
    }
    this.scheduleFlush()
  }

  private cancelDwell(postId: string) {
    const handle = this.dwellTimers.get(postId)
    if (handle === undefined) return
    this.timers.clearTimeout(handle)
    this.dwellTimers.delete(postId)
  }

  private scheduleFlush() {
    if (this.flushTimer !== null) return
    this.flushTimer = this.timers.setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, IMPRESSION_FLUSH_MS)
  }

  private clearFlushTimer() {
    if (this.flushTimer === null) return
    this.timers.clearTimeout(this.flushTimer)
    this.flushTimer = null
  }
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
        // 400 and 401 will not get better with a retry; drop those ids.
        return response.ok || response.status === 400 || response.status === 401
      } catch {
        return false
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
