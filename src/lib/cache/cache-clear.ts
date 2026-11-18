/**
 * Owner (18 Nov, ₹0): short-lived caches that every web server clears the moment the data changes, wherever the change
 * was made. Migration 0111 makes each change to cached data send a NOTIFY on CACHE_CLEAR_CHANNEL with a short tag
 * (p:<profile>, co:<company>, i:<cognito subject>, c:<profile counts>, s:<sign-in>); Postgres sends it only when the
 * change commits. Each server listens on one connection and drops the entries carrying that tag.
 *
 * The owner's rule: if anything about the clear fails, cache nothing rather than risk stale data. So a server caches only
 * while its listener is connected AND a heartbeat it sent through the database came back within HEARTBEAT_TIMEOUT_MS.
 * On any loss everything cached is dropped, nothing is cached until the listener is back and a heartbeat has returned,
 * and an answer read while the listener was down is never kept. Each entry also expires after its own short time.
 *
 * A read racing a change cannot keep the old value: every load notes the clear sequence before it reads, and its answer
 * is kept only if none of its tags was cleared since. A change made by this server is waited for (writeBarrier): after
 * a write to a cached table commits, the server sends a heartbeat and waits for it, and Postgres delivers notifications
 * in commit order, so this server's own clears have arrived before its next read.
 */

export const CACHE_CLEAR_CHANNEL = 'sns_cache_clear'
export const HEARTBEAT_MS = 15_000
export const HEARTBEAT_TIMEOUT_MS = 5_000
const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 30_000
/** A load slower than this is never kept (statements stop at 10 s; this leaves a wide margin). */
const MAX_LOAD_MS = 30_000
/** How long a tag's last clear is remembered for the race check (longer than any kept load). */
const TAG_MEMORY_MS = 2 * MAX_LOAD_MS

export type ListenerConnection = { close(): Promise<void> }

export type CacheClearTransport = {
  /** Opens the dedicated listening connection; onLost is called once if it ends or fails. */
  listen(channel: string, onMessage: (payload: string) => void, onLost: (reason: string) => void): Promise<ListenerConnection>
  /** Sends one NOTIFY on the channel through the ordinary pool (the heartbeat). */
  notify(channel: string, payload: string): Promise<void>
}

type Clearable = { dropTag(tag: string): void; dropAll(): void }

export type Ticket = { epoch: number; seq: number; at: number }

export function createCacheClearHub(input: {
  transport: CacheClearTransport
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => { unref?: () => void } | unknown
  clearTimer?: (timer: unknown) => void
  random?: () => number
  log?: (tag: string, context: Record<string, string | number>) => void
}) {
  const now = input.now ?? Date.now
  const setTimer = input.setTimer ?? ((fn: () => void, ms: number) => {
    const timer = setTimeout(fn, ms)
    timer.unref?.()
    return timer
  })
  const clearTimer = input.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  const random = input.random ?? Math.random
  const log = input.log ?? ((tag, context) => console.warn(tag, context))

  const caches = new Set<Clearable>()
  const tagCleared = new Map<string, { seq: number; at: number }>()
  const waiting = new Map<string, () => void>()
  let connection: ListenerConnection | null = null
  let connecting = false
  let healthy = false
  let epoch = 0
  let seq = 0
  let failures = 0
  let heartbeatTimer: unknown = null
  let started = false
  let nonce = 0

  function dropEverything() {
    epoch += 1
    seq += 1
    for (const cache of caches) cache.dropAll()
  }

  function rememberClear(tag: string) {
    seq += 1
    tagCleared.set(tag, { seq, at: now() })
    if (tagCleared.size > 50_000) {
      const cutoff = now() - TAG_MEMORY_MS
      for (const [key, value] of tagCleared) if (value.at < cutoff) tagCleared.delete(key)
    }
  }

  function onMessage(payload: string) {
    if (payload.startsWith('hb:')) {
      waiting.get(payload)?.()
      return
    }
    rememberClear(payload)
    for (const cache of caches) cache.dropTag(payload)
  }

  function lose(reason: string) {
    const wasHealthy = healthy
    healthy = false
    dropEverything()
    for (const resolve of waiting.values()) resolve()
    waiting.clear()
    if (heartbeatTimer !== null) clearTimer(heartbeatTimer)
    heartbeatTimer = null
    const old = connection
    connection = null
    void old?.close().catch(() => undefined)
    if (wasHealthy) log('[cache_clear_listener_lost]', { reason: reason.slice(0, 80) })
    scheduleConnect()
  }

  /** Sends a heartbeat and resolves true when it comes back through the listener in time. */
  async function roundTrip(): Promise<boolean> {
    if (!connection) return false
    nonce += 1
    const payload = `hb:${process.pid}:${now()}:${nonce}`
    let arrived = false
    const done = new Promise<void>((resolve) => waiting.set(payload, () => { arrived = true; resolve() }))
    let timer: unknown = null
    const timeout = new Promise<void>((resolve) => { timer = setTimer(resolve, HEARTBEAT_TIMEOUT_MS) })
    try {
      await input.transport.notify(CACHE_CLEAR_CHANNEL, payload)
      await Promise.race([done, timeout])
    } catch {
      arrived = false
    } finally {
      if (timer !== null) clearTimer(timer)
      waiting.delete(payload)
    }
    return arrived && connection !== null
  }

  function scheduleHeartbeat() {
    heartbeatTimer = setTimer(async () => {
      heartbeatTimer = null
      if (!connection) return
      if (await roundTrip()) scheduleHeartbeat()
      else lose('heartbeat_missed')
    }, HEARTBEAT_MS)
  }

  function scheduleConnect() {
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.min(failures, 5)) * (0.5 + random() / 2)
    failures += 1
    setTimer(() => { void connect() }, delay)
  }

  async function connect() {
    if (connecting || connection) return
    connecting = true
    try {
      let lost = false
      const opened = await input.transport.listen(CACHE_CLEAR_CHANNEL, onMessage, (reason) => {
        lost = true
        if (connection === opened) lose(reason)
      })
      if (lost) {
        void opened.close().catch(() => undefined)
        scheduleConnect()
        return
      }
      connection = opened
      // Healthy only once a heartbeat has made the whole trip: pool -> database -> this listener.
      if (await roundTrip()) {
        failures = 0
        dropEverything()
        healthy = true
        scheduleHeartbeat()
      } else {
        lose('first_heartbeat_missed')
      }
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : 'connect_failed'
      if (failures === 0) log('[cache_clear_listener_unavailable]', { reason: code.slice(0, 40) })
      scheduleConnect()
    } finally {
      connecting = false
    }
  }

  return {
    /** Starts listening (once). Until the first heartbeat returns, nothing is cached. */
    start() {
      if (started) return
      started = true
      void connect()
    },
    healthy: () => healthy,
    /** The hub's clock, shared by its caches. */
    now: () => now(),
    register(cache: Clearable) {
      caches.add(cache)
      return () => { caches.delete(cache) }
    },
    ticket(): Ticket {
      return { epoch, seq, at: now() }
    },
    /** True when an answer loaded under `ticket` may be kept: still healthy, same epoch, no tag cleared since. */
    stillValid(ticket: Ticket, tags: readonly string[]) {
      if (!healthy || ticket.epoch !== epoch || now() - ticket.at > MAX_LOAD_MS) return false
      return tags.every((tag) => (tagCleared.get(tag)?.seq ?? 0) <= ticket.seq)
    },
    /**
     * After this server changed cached data: waits until its own clears have arrived (a heartbeat sent after the
     * commit comes back after them). If it does not come back, the listener is treated as lost (nothing cached).
     */
    async writeBarrier() {
      if (!healthy) return
      if (!(await roundTrip())) lose('barrier_missed')
    },
    /** Tests and shutdown. */
    async stop() {
      started = false
      healthy = false
      if (heartbeatTimer !== null) clearTimer(heartbeatTimer)
      heartbeatTimer = null
      const old = connection
      connection = null
      dropEverything()
      await old?.close().catch(() => undefined)
    },
  }
}

export type CacheClearHub = ReturnType<typeof createCacheClearHub>

type Entry<V> = { value: V; tags: readonly string[]; expiresAt: number; epoch: number }

/**
 * One cache of loaded answers. getOrLoad answers from the cache only while the hub is healthy; otherwise it always
 * loads. Answers are kept for at most ttlMs, dropped when any of their tags is cleared, and never kept when a tag was
 * cleared while they were loading. Every caller gets its own copy, so no caller can change what others are served.
 */
export function createClearableCache<V>(input: {
  hub: CacheClearHub
  ttlMs: number
  maxEntries: number
  now?: () => number
}) {
  const now = input.now ?? input.hub.now
  const entries = new Map<string, Entry<V>>()
  const byTag = new Map<string, Set<string>>()

  function forget(key: string) {
    const entry = entries.get(key)
    if (!entry) return
    entries.delete(key)
    for (const tag of entry.tags) {
      const keys = byTag.get(tag)
      keys?.delete(key)
      if (keys && keys.size === 0) byTag.delete(tag)
    }
  }

  const clearable: Clearable = {
    dropTag(tag) {
      for (const key of [...(byTag.get(tag) ?? [])]) forget(key)
    },
    dropAll() {
      entries.clear()
      byTag.clear()
    },
  }
  input.hub.register(clearable)

  function store(key: string, value: V, tags: readonly string[]) {
    forget(key)
    if (entries.size >= input.maxEntries) {
      const timestamp = now()
      for (const [k, entry] of entries) if (entry.expiresAt <= timestamp) forget(k)
      if (entries.size >= input.maxEntries) forget(entries.keys().next().value as string)
    }
    entries.set(key, { value, tags, expiresAt: now() + input.ttlMs, epoch: input.hub.ticket().epoch })
    for (const tag of tags) {
      let keys = byTag.get(tag)
      if (!keys) byTag.set(tag, keys = new Set())
      keys.add(key)
    }
  }

  return {
    async getOrLoad(key: string, load: () => Promise<V>, tagsOf: (value: V) => readonly string[] | null): Promise<V> {
      input.hub.start()
      if (!input.hub.healthy()) return load()
      const hit = entries.get(key)
      if (hit && hit.expiresAt > now() && hit.epoch === input.hub.ticket().epoch) return structuredClone(hit.value)
      if (hit) forget(key)
      const ticket = input.hub.ticket()
      const value = await load()
      const tags = tagsOf(value)
      // null: never keep this answer (for example "not found", which a sign-up can change at any moment).
      if (tags && tags.length > 0 && input.hub.stillValid(ticket, tags)) store(key, structuredClone(value), tags)
      return value
    },
    size: () => entries.size,
    clearable,
  }
}

