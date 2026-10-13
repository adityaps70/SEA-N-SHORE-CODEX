import { createMediaImageSrc } from '@/lib/images/media-image-src'
import { createResultCache } from './result-cache'
import type { SuggestItem, SuggestResponse } from './search-client'
import { SearchTimeoutError, searchRepository, type SearchHit } from './search-repository'
import { SEARCH_KINDS, SEARCH_WEIGHTS, normaliseSearchQuery, type SearchKind } from './search-weights'

/**
 * Round G (G4): the search service behind the dropdown (GET /api/search/suggest) and /search.
 * Organizations, communities and courses do not depend on who is searching, so their dropdown
 * results are kept per normalised query for 45 s in this task's memory; people, jobs, events and
 * posts (blocks, connections, private communities) are always searched live, in one statement.
 * A statement timeout returns what is ready (cached kinds) with partial: true, never an error.
 */
type Repository = Pick<typeof searchRepository, 'search'>
type Sign = (path: string) => Promise<string>

const CACHED_KINDS: readonly SearchKind[] = ['org', 'community', 'course']
const SUGGEST_ORDER: readonly SearchKind[] = ['person', 'org', 'community', 'job', 'course', 'event']

export const SEARCH_TABS = ['all', 'people', 'posts', 'jobs', 'orgs', 'communities', 'courses', 'events'] as const
export type SearchTab = (typeof SEARCH_TABS)[number]
export const TAB_KIND: Record<Exclude<SearchTab, 'all'>, SearchKind> = {
  people: 'person', posts: 'post', jobs: 'job', orgs: 'org', communities: 'community', courses: 'course', events: 'event',
}
export const ALL_TAB_LIMITS: Record<SearchKind, number> = { person: 6, post: 5, job: 4, org: 4, community: 4, course: 3, event: 3 }

export function hrefFor(hit: Pick<SearchHit, 'kind' | 'id' | 'slug'>): string {
  switch (hit.kind) {
    case 'person': return hit.slug ? `/people/${hit.slug}` : '/network'
    case 'org': return hit.slug ? `/organizations/${hit.slug}` : '/organizations'
    case 'community': return hit.slug ? `/community/${hit.slug}` : '/community'
    case 'job': return `/jobs/${hit.id}`
    case 'course': return hit.slug ? `/learn/courses/${hit.slug}` : '/learn'
    case 'event': return `/events/${hit.id}`
    case 'post': return `/posts/${hit.id}`
  }
}

export function createSearchService(input: { repository?: Repository; sign?: Sign; now?: () => number } = {}) {
  const repository = input.repository ?? searchRepository
  const sign: Sign = input.sign ?? createMediaImageSrc
  const cache = createResultCache<SearchHit[]>({ ...SEARCH_WEIGHTS.cache, ...(input.now ? { now: input.now } : {}) })

  async function toItem(hit: SearchHit): Promise<SuggestItem> {
    let avatarUrl: string | null = null
    if (hit.avatarPath && hit.kind !== 'post') avatarUrl = await sign(hit.avatarPath).catch(() => null)
    return { id: hit.id, kind: hit.kind, name: hit.name, subtitle: hit.subtitle, avatarUrl, href: hrefFor(hit) }
  }

  async function suggest(viewerId: string, raw: string): Promise<SuggestResponse> {
    const normalized = normaliseSearchQuery(raw)
    if (!normalized) return { query: raw, items: [] }
    const cached = cache.get(normalized)
    const limits: Partial<Record<SearchKind, number>> = {}
    for (const kind of SEARCH_KINDS) {
      if ((cached && CACHED_KINDS.includes(kind)) || !SEARCH_WEIGHTS.suggest[kind]) continue
      limits[kind] = SEARCH_WEIGHTS.suggest[kind]
    }
    let live: SearchHit[] = []
    let partial = false
    try {
      live = await repository.search({ viewerId, query: raw, limits, fullText: false })
    } catch (error) {
      if (!(error instanceof SearchTimeoutError)) throw error
      partial = true
    }
    if (!cached && !partial) cache.set(normalized, live.filter((hit) => CACHED_KINDS.includes(hit.kind)))
    const hits = [...live.filter((hit) => !CACHED_KINDS.includes(hit.kind) || !cached), ...(cached ?? [])]
    // One slot for a course or an event: whichever matches better.
    const courseOrEvent = hits.filter((hit) => hit.kind === 'course' || hit.kind === 'event').sort((left, right) => right.score - left.score)[0]
    const ordered = SUGGEST_ORDER.flatMap((kind) => {
      if (kind === 'course' || kind === 'event') return courseOrEvent?.kind === kind ? [courseOrEvent] : []
      return hits.filter((hit) => hit.kind === kind).slice(0, SEARCH_WEIGHTS.suggest[kind])
    })
    return { query: raw, items: await Promise.all(ordered.map(toItem)), ...(partial ? { partial: true } : {}) }
  }

  /** /search: every kind (a few each) for All, or one kind paged 20 at a time. */
  async function page(viewerId: string, raw: string, tab: SearchTab, pageNumber = 1) {
    const kinds = tab === 'all' ? SEARCH_KINDS : [TAB_KIND[tab]]
    const offset = tab === 'all' ? 0 : (Math.max(1, pageNumber) - 1) * SEARCH_WEIGHTS.pageSize
    const limits = Object.fromEntries(kinds.map((kind) => [kind, tab === 'all' ? ALL_TAB_LIMITS[kind] : SEARCH_WEIGHTS.pageSize + 1]))
    let hits: SearchHit[] = []
    let partial = false
    try {
      hits = await repository.search({ viewerId, query: raw, limits, offset })
    } catch (error) {
      if (!(error instanceof SearchTimeoutError)) throw error
      partial = true
    }
    const groups = Object.fromEntries(kinds.map((kind) => [kind, hits.filter((hit) => hit.kind === kind)])) as Partial<Record<SearchKind, SearchHit[]>>
    const single = tab === 'all' ? null : TAB_KIND[tab]
    const hasMore = single ? (groups[single]?.length ?? 0) > SEARCH_WEIGHTS.pageSize : false
    if (single && groups[single]) groups[single] = groups[single]!.slice(0, SEARCH_WEIGHTS.pageSize)
    const total = Object.values(groups).reduce((sum, list) => sum + (list?.length ?? 0), 0)
    return { query: raw, tab, page: Math.max(1, pageNumber), groups, hasMore, partial, total }
  }

  return { suggest, page, toItem }
}

export const searchService = createSearchService()
