/**
 * Round CAP (shared cache, owner-approved 13 Nov): a short in-process cache for data that is the same for every
 * viewer. Each web task keeps its own copy for `ttlMs` (5–30 s); concurrent misses for one key share one load; a
 * failed load is never kept. `clear()` empties it on this task (an admin change); other tasks catch up within the
 * TTL.
 *
 * Only for reads that take no viewer, member, permission or session input: the key is built from the read's own
 * arguments. Never use it for personal or permission-dependent data. SHARED_CACHES lists every use, and
 * shared-cache.contract.test.ts checks that none of them takes a viewer.
 */
export const SHARED_CACHE_MIN_TTL_MS = 5_000
export const SHARED_CACHE_MAX_TTL_MS = 30_000

export function createSharedCache<T>(input: { name: string; ttlMs: number; maxEntries?: number; now?: () => number }) {
  if (input.ttlMs < SHARED_CACHE_MIN_TTL_MS || input.ttlMs > SHARED_CACHE_MAX_TTL_MS) throw new Error('shared_cache_ttl_out_of_range')
  const now = input.now ?? Date.now
  const maxEntries = input.maxEntries ?? 200
  const entries = new Map<string, { at: number; value: T }>()
  const inFlight = new Map<string, Promise<T>>()
  let generation = 0

  async function get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = entries.get(key)
    if (hit && now() - hit.at < input.ttlMs) return hit.value
    const pending = inFlight.get(key)
    if (pending) return pending
    const started = generation
    const loading = load()
      .then((value) => {
        // A clear() during the load means the value may predate the change: return it, but do not keep it.
        if (started === generation) {
          entries.delete(key)
          entries.set(key, { at: now(), value })
          while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string)
        }
        return value
      })
      .finally(() => inFlight.delete(key))
    inFlight.set(key, loading)
    return loading
  }

  function clear() {
    generation += 1
    entries.clear()
    inFlight.clear()
  }

  return { name: input.name, get, clear, size: () => entries.size }
}
