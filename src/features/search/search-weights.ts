/**
 * Round G (G4): every weight, limit and threshold of search. Change the numbers here and bump
 * SEARCH_WEIGHTS_VERSION; tests check order and privacy, not exact scores.
 */
export const SEARCH_WEIGHTS_VERSION = 'search-2026-10-13.1'

export const SEARCH_KINDS = ['person', 'org', 'community', 'job', 'course', 'event', 'post'] as const
export type SearchKind = (typeof SEARCH_KINDS)[number]

export const SEARCH_WEIGHTS = {
  /** Relevance tiers: exact name, name starts with the query, typo match on the name, full text. */
  tiers: { exact: 400, prefix: 300, trigram: 200, fullText: 100 },
  /** Added to the trigram tier: word similarity (0..1) × this. */
  trigramScale: 100,
  /** Added to the full-text tier: ts_rank (0..1) × this. */
  fullTextScale: 60,
  /** People boosts, added after relevance. */
  boosts: { connection: 40, secondDegree: 20, verified: 12, recentlyActive: 10 },
  recentlyActiveDays: 30,
  /** Popularity (log-scaled follower, member or reaction counts) adds at most this. */
  popularityCap: 15,
  /** pg_trgm word similarity needed for a typo match ("Sachn" finds "Sachin"). */
  wordSimilarityThreshold: 0.5,
  /** Typo and full-text matching start at this many characters; one character is prefix only. */
  fuzzyFromChars: 2,
  /** Full text over headlines, descriptions and posts starts at this many characters. */
  fullTextFromChars: 3,
  maxQueryLength: 80,
  /** The dropdown: up to this many per kind. Course and event share one slot. */
  suggest: { person: 3, org: 2, community: 2, job: 2, course: 1, event: 1, post: 0 } as Record<SearchKind, number>,
  /** The full page. */
  pageSize: 20,
  /** Candidates per kind looked at before the visibility re-check and the final limit. */
  candidatesPerKind: 60,
  statementTimeoutMs: 300,
  /** Viewer-independent results (orgs, communities, jobs, courses, events) per normalised query. */
  cache: { ttlMs: 45_000, maxEntries: 2000 },
  rateLimit: { perSecond: 10, perMinute: 120 },
} as const

/** The same text key as public.taxonomy_normalize() and the taxonomy matchers. */
export function normaliseSearchQuery(raw: string | null | undefined): string {
  return (raw ?? '')
    .slice(0, SEARCH_WEIGHTS.maxQueryLength)
    .toLocaleLowerCase('en')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}
