/**
 * Round G (G4): an in-process LRU for viewer-independent search results (orgs, communities, jobs,
 * courses, events) per normalised query. Never holds people or posts. Entries expire after the TTL
 * (30–60 s), so a new or renamed page shows up within a minute without any invalidation.
 */
export function createResultCache<T>(input: { ttlMs: number; maxEntries: number; now?: () => number }) {
  const now = input.now ?? Date.now
  const entries = new Map<string, { at: number; value: T }>()

  return {
    get(key: string): T | undefined {
      const hit = entries.get(key)
      if (!hit) return undefined
      if (now() - hit.at > input.ttlMs) {
        entries.delete(key)
        return undefined
      }
      // Least recently used goes first: re-insert on read.
      entries.delete(key)
      entries.set(key, hit)
      return hit.value
    },
    set(key: string, value: T) {
      entries.delete(key)
      entries.set(key, { at: now(), value })
      while (entries.size > input.maxEntries) entries.delete(entries.keys().next().value as string)
    },
    get size() {
      return entries.size
    },
  }
}
