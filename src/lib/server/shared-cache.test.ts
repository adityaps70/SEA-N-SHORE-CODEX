import { describe, expect, it, vi } from 'vitest'
import { createSharedCache } from './shared-cache'

/** Round CAP (shared cache): short, per key, one load for concurrent misses, failures never kept, clear works. */
describe('createSharedCache', () => {
  it('keeps a value for the TTL only and loads once for concurrent misses', async () => {
    let clock = 0
    const cache = createSharedCache<number>({ name: 'test', ttlMs: 15_000, now: () => clock })
    const load = vi.fn(async () => 7)
    expect(await Promise.all([cache.get('k', load), cache.get('k', load), cache.get('k', load)])).toEqual([7, 7, 7])
    expect(load).toHaveBeenCalledTimes(1)
    clock = 14_999
    await cache.get('k', load)
    expect(load).toHaveBeenCalledTimes(1)
    clock = 15_000
    await cache.get('k', load)
    expect(load).toHaveBeenCalledTimes(2)
    await cache.get('other', load)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('never keeps a failure, and clear() drops values and a load that was running', async () => {
    const cache = createSharedCache<string>({ name: 'test', ttlMs: 10_000 })
    await expect(cache.get('k', async () => { throw new Error('db_down') })).rejects.toThrow('db_down')
    expect(await cache.get('k', async () => 'fresh')).toBe('fresh')
    cache.clear()
    expect(await cache.get('k', async () => 'after clear')).toBe('after clear')
    let release: (value: string) => void = () => {}
    const slow = cache.get('slow', () => new Promise<string>((resolve) => { release = resolve }))
    cache.clear()
    release('before change')
    expect(await slow).toBe('before change')
    expect(await cache.get('slow', async () => 'after change')).toBe('after change')
  })

  it('caps entries and refuses a TTL outside 5-30 s', async () => {
    const cache = createSharedCache<number>({ name: 'test', ttlMs: 5_000, maxEntries: 2 })
    for (const key of ['a', 'b', 'c']) await cache.get(key, async () => 1)
    expect(cache.size()).toBe(2)
    expect(() => createSharedCache({ name: 'test', ttlMs: 4_999 })).toThrow('shared_cache_ttl_out_of_range')
    expect(() => createSharedCache({ name: 'test', ttlMs: 30_001 })).toThrow('shared_cache_ttl_out_of_range')
  })
})
