import { describe, expect, it } from 'vitest'
import { createCacheClearHub, createClearableCache, HEARTBEAT_MS, HEARTBEAT_TIMEOUT_MS, type CacheClearTransport } from './cache-clear'

type Timer = { fn: () => void; at: number; done: boolean }

function harness(options: { listenFails?: number; installed?: () => boolean } = {}) {
  let clock = 1_000_000
  const timers: Timer[] = []
  let onMessage: ((payload: string) => void) | null = null
  let onLost: ((reason: string) => void) | null = null
  let open = false
  let deliver = true
  let listenFailures = options.listenFails ?? 0
  const notified: string[] = []
  const transport: CacheClearTransport = {
    async listen(_channel, message, lost) {
      if (listenFailures > 0) {
        listenFailures -= 1
        throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })
      }
      onMessage = message
      onLost = lost
      open = true
      return { close: async () => { open = false } }
    },
    async clearsInstalled() {
      return options.installed ? options.installed() : true
    },
    async notify(_channel, payload) {
      notified.push(payload)
      // Postgres delivers in commit order; the fake delivers in send order, after the caller's await.
      if (deliver && open) queueMicrotask(() => onMessage?.(payload))
    },
  }
  const hub = createCacheClearHub({
    transport,
    now: () => clock,
    setTimer: (fn, ms) => { const timer = { fn, at: clock + ms, done: false }; timers.push(timer); return timer },
    clearTimer: (timer) => { (timer as Timer).done = true },
    random: () => 1,
    log: () => undefined,
  })
  const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve() }
  return {
    hub,
    transport,
    notified,
    flush,
    async advance(ms: number) {
      clock += ms
      for (const timer of timers) {
        if (!timer.done && timer.at <= clock) {
          timer.done = true
          timer.fn()
          await flush()
        }
      }
      await flush()
    },
    /** A change committed elsewhere: its clear arrives through the listener. */
    clear(tag: string) { onMessage?.(tag) },
    lose() { open = false; onLost?.('connection_ended') },
    setDeliver(value: boolean) { deliver = value },
  }
}

async function healthyHarness() {
  const h = harness()
  h.hub.start()
  await h.flush()
  expect(h.hub.healthy()).toBe(true)
  return h
}

function counter<V>(value: () => V) {
  let calls = 0
  return { load: async () => { calls += 1; return value() }, calls: () => calls }
}

describe('cache clear hub and caches (owner 18 Nov)', () => {
  it('caches nothing until the listener is connected and a heartbeat has come back through the database', async () => {
    const h = harness({ listenFails: 1 })
    const cache = createClearableCache<{ name: string }>({ hub: h.hub, ttlMs: 60_000, maxEntries: 10 })
    const source = counter(() => ({ name: 'A' }))
    await cache.getOrLoad('p1', source.load, () => ['p:1'])
    await cache.getOrLoad('p1', source.load, () => ['p:1'])
    expect(source.calls()).toBe(2)
    expect(cache.size()).toBe(0)
    // The reconnect succeeds and its first heartbeat returns: only now is anything kept.
    await h.advance(60_000)
    expect(h.hub.healthy()).toBe(true)
    await cache.getOrLoad('p1', source.load, () => ['p:1'])
    await cache.getOrLoad('p1', source.load, () => ['p:1'])
    expect(source.calls()).toBe(3)
  })

  it('caches nothing while the clear triggers are missing (app deployed before migration 0111), however healthy the listener', async () => {
    let installed = false
    const h = harness({ installed: () => installed })
    const cache = createClearableCache<number>({ hub: h.hub, ttlMs: 60_000, maxEntries: 10 })
    h.hub.start()
    await h.flush()
    expect(h.hub.healthy()).toBe(false)
    const source = counter(() => 1)
    await cache.getOrLoad('k', source.load, () => ['c:1'])
    await cache.getOrLoad('k', source.load, () => ['c:1'])
    expect(source.calls()).toBe(2)
    // The migration is applied: the next reconnect finds the triggers and caching starts.
    installed = true
    await h.advance(60_000)
    expect(h.hub.healthy()).toBe(true)
  })

  it('serves a kept answer until its tag is cleared, then loads afresh', async () => {
    const h = await healthyHarness()
    const cache = createClearableCache<{ name: string }>({ hub: h.hub, ttlMs: 60_000, maxEntries: 10 })
    let name = 'A'
    const source = counter(() => ({ name }))
    expect(await cache.getOrLoad('p1', source.load, () => ['p:1'])).toEqual({ name: 'A' })
    name = 'B'
    expect(await cache.getOrLoad('p1', source.load, () => ['p:1'])).toEqual({ name: 'A' })
    h.clear('p:2')
    expect(await cache.getOrLoad('p1', source.load, () => ['p:1'])).toEqual({ name: 'A' })
    h.clear('p:1')
    expect(await cache.getOrLoad('p1', source.load, () => ['p:1'])).toEqual({ name: 'B' })
    expect(source.calls()).toBe(2)
  })

  it('never keeps an answer whose tag was cleared while it was loading', async () => {
    const h = await healthyHarness()
    const cache = createClearableCache<{ name: string }>({ hub: h.hub, ttlMs: 60_000, maxEntries: 10 })
    let calls = 0
    const racing = async () => {
      calls += 1
      const value = { name: `read-${calls}` }
      if (calls === 1) h.clear('p:1') // the change commits after this read but before it returns
      return value
    }
    await cache.getOrLoad('p1', racing, () => ['p:1'])
    expect(cache.size()).toBe(0)
    expect(await cache.getOrLoad('p1', racing, () => ['p:1'])).toEqual({ name: 'read-2' })
    expect(await cache.getOrLoad('p1', racing, () => ['p:1'])).toEqual({ name: 'read-2' })
    expect(calls).toBe(2)
  })

  it('drops everything and stops caching when the listener is lost, keeping nothing read while it was down', async () => {
    const h = await healthyHarness()
    const cache = createClearableCache<number>({ hub: h.hub, ttlMs: 60_000, maxEntries: 10 })
    const source = counter(() => 1)
    await cache.getOrLoad('k', source.load, () => ['c:1'])
    expect(cache.size()).toBe(1)
    h.lose()
    expect(h.hub.healthy()).toBe(false)
    expect(cache.size()).toBe(0)
    await cache.getOrLoad('k', source.load, () => ['c:1'])
    await cache.getOrLoad('k', source.load, () => ['c:1'])
    expect(source.calls()).toBe(3)
    expect(cache.size()).toBe(0)
    await h.advance(60_000)
    expect(h.hub.healthy()).toBe(true)
  })

  it('treats a heartbeat that does not come back in time as a lost listener', async () => {
    const h = await healthyHarness()
    const cache = createClearableCache<number>({ hub: h.hub, ttlMs: 10 * 60_000, maxEntries: 10 })
    await cache.getOrLoad('k', async () => 1, () => ['c:1'])
    await h.advance(HEARTBEAT_MS)
    expect(h.hub.healthy()).toBe(true)
    expect(cache.size()).toBe(1)
    // Notifications stop arriving (a silently dead connection): the next heartbeat times out.
    h.setDeliver(false)
    await h.advance(HEARTBEAT_MS)
    await h.advance(HEARTBEAT_TIMEOUT_MS)
    expect(h.hub.healthy()).toBe(false)
    expect(cache.size()).toBe(0)
  })

  it('after this server writes, waits until its own clears have arrived before it reads again', async () => {
    const h = await healthyHarness()
    const cache = createClearableCache<{ name: string }>({ hub: h.hub, ttlMs: 60_000, maxEntries: 10 })
    let name = 'A'
    await cache.getOrLoad('p1', async () => ({ name }), () => ['p:1'])
    // The write commits; its trigger's NOTIFY is on its way (sent before the barrier's heartbeat).
    name = 'B'
    await h.transport.notify('sns_cache_clear', 'p:1')
    await h.hub.writeBarrier()
    expect(await cache.getOrLoad('p1', async () => ({ name }), () => ['p:1'])).toEqual({ name: 'B' })
  })

  it('a barrier whose heartbeat never returns stops caching rather than risk a stale read', async () => {
    const h = await healthyHarness()
    const cache = createClearableCache<number>({ hub: h.hub, ttlMs: 60_000, maxEntries: 10 })
    await cache.getOrLoad('k', async () => 1, () => ['c:1'])
    h.setDeliver(false)
    const barrier = h.hub.writeBarrier()
    await h.advance(HEARTBEAT_TIMEOUT_MS)
    await barrier
    expect(h.hub.healthy()).toBe(false)
    expect(cache.size()).toBe(0)
  })

  it('expires answers after their time, never keeps answers without tags, and gives each caller its own copy', async () => {
    const h = await healthyHarness()
    const cache = createClearableCache<{ list: number[] } | null>({ hub: h.hub, ttlMs: 60_000, maxEntries: 10 })
    const source = counter(() => ({ list: [1] }))
    const first = await cache.getOrLoad('k', source.load, () => ['c:1'])
    first!.list.push(99)
    const second = await cache.getOrLoad('k', source.load, () => ['c:1'])
    expect(second).toEqual({ list: [1] })
    second!.list.push(98)
    expect(await cache.getOrLoad('k', source.load, () => ['c:1'])).toEqual({ list: [1] })
    expect(source.calls()).toBe(1)
    await h.advance(60_001)
    await cache.getOrLoad('k', source.load, () => ['c:1'])
    expect(source.calls()).toBe(2)
    const missing = counter(() => null)
    await cache.getOrLoad('none', missing.load, () => null)
    await cache.getOrLoad('none', missing.load, () => null)
    expect(missing.calls()).toBe(2)
  })

  it('sends only heartbeats itself: ids for clears come from the database triggers, never from the app', async () => {
    const h = await healthyHarness()
    expect(h.notified.every((payload) => payload.startsWith('hb:'))).toBe(true)
  })
})
