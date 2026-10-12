/**
 * Round F: a per-IP sliding window for pages anyone can open without an account (shared post links).
 * It lives in this server instance's memory: a best-effort guard against scraping, not an exact global
 * quota. The WAF's per-IP limit still applies in front of it.
 */
export const PUBLIC_POST_WINDOW_MS = 60_000
export const PUBLIC_POST_MAX_PER_WINDOW = 60

export function createPublicPageRateLimiter(input: { windowMs?: number; maxPerWindow?: number; now?: () => number } = {}) {
  const windowMs = input.windowMs ?? PUBLIC_POST_WINDOW_MS
  const maxPerWindow = input.maxPerWindow ?? PUBLIC_POST_MAX_PER_WINDOW
  const now = input.now ?? Date.now
  const hits = new Map<string, number[]>()

  return function allow(key: string) {
    const current = now()
    const recent = (hits.get(key) ?? []).filter((timestamp) => current - timestamp < windowMs)
    if (recent.length >= maxPerWindow) {
      hits.set(key, recent)
      return false
    }
    recent.push(current)
    hits.set(key, recent)
    if (hits.size > 5000) {
      for (const [entryKey, timestamps] of hits) {
        if (!timestamps.some((timestamp) => current - timestamp < windowMs)) hits.delete(entryKey)
      }
    }
    return true
  }
}
