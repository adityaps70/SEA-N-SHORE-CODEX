import {
  normalizeOrganizationSearchTerm,
  ORGANIZATION_SEARCH_MIN_LENGTH,
  type OrganizationSearchResult,
} from './organization-link'
import type { OrganizationLinkRepository } from './organization-link-repository'

export const ORGANIZATION_SEARCH_WINDOW_MS = 60_000
export const ORGANIZATION_SEARCH_MAX_PER_WINDOW = 60

export type OrganizationSearchOutcome =
  | { ok: true; query: string; organizations: OrganizationSearchResult[] }
  | { ok: false; code: 'rate_limited'; message: string }

/**
 * Per-member sliding window so the type-ahead cannot be used to scrape the
 * directory. The picker debounces typing, so normal use stays far below it.
 * The window lives in this server instance's memory: a best-effort guard, not
 * an exact global quota.
 */
export function createSearchRateLimiter(input: {
  windowMs?: number
  maxPerWindow?: number
  now?: () => number
} = {}) {
  const windowMs = input.windowMs ?? ORGANIZATION_SEARCH_WINDOW_MS
  const maxPerWindow = input.maxPerWindow ?? ORGANIZATION_SEARCH_MAX_PER_WINDOW
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

export function createOrganizationSearchService(input: {
  repository: Pick<OrganizationLinkRepository, 'searchListableOrganizations'>
  allow?: (key: string) => boolean
}) {
  const allow = input.allow ?? createSearchRateLimiter()

  async function search(userId: string, rawQuery: unknown): Promise<OrganizationSearchOutcome> {
    const query = normalizeOrganizationSearchTerm(rawQuery)
    if (query.length < ORGANIZATION_SEARCH_MIN_LENGTH) return { ok: true, query, organizations: [] }
    if (!allow(userId)) {
      return {
        ok: false,
        code: 'rate_limited',
        message: 'You searched a lot in the last minute. Wait a moment and try again, or keep typing the name and save it as text.',
      }
    }
    return { ok: true, query, organizations: await input.repository.searchListableOrganizations(query) }
  }

  return { search }
}
