import Link from '@/components/navigation/intent-link'
import { ArrowLeft, BookOpen, BriefcaseBusiness, Building2, CalendarDays, FileText, UsersRound } from 'lucide-react'
import { MediaImage } from '@/components/ui/media-image'
import { CommunityCategoryFacet } from '@/features/community/components/category-facet'
import { communityRepository } from '@/features/community/repository'
import { getNetworkProfilesByIds } from '@/features/network/queries'
import { LivePageSearch } from '@/features/search/components/live-page-search'
import { highlightParts } from '@/features/search/highlight'
import type { SearchHit } from '@/features/search/search-repository'
import { ALL_TAB_LIMITS, SEARCH_TABS, TAB_KIND, hrefFor, searchService, type SearchTab } from '@/features/search/search-service'
import { SEARCH_WEIGHTS, type SearchKind } from '@/features/search/search-weights'
import { createMediaImageSrc } from '@/lib/images/media-image-src'
import { relativeTimeFrom } from '@/lib/relative-time'
import { SearchPersonRow } from './search-result-rows'

/**
 * Round G (G4): /search when the search switch is on. Tabs People · Posts · Jobs · Orgs ·
 * Communities · Courses · Events (and All), all from search_documents, paged 20 at a time,
 * updating as the member types. Privacy is applied in the query (blocks, private communities,
 * post visibility); nothing here filters big lists.
 */
const TAB_LABELS: Record<SearchTab, string> = {
  all: 'All', people: 'People', posts: 'Posts', jobs: 'Jobs', orgs: 'Organizations', communities: 'Communities', courses: 'Courses', events: 'Events',
}
const KIND_TAB: Record<SearchKind, Exclude<SearchTab, 'all'>> = {
  person: 'people', post: 'posts', job: 'jobs', org: 'orgs', community: 'communities', course: 'courses', event: 'events',
}
const KIND_ICON = { person: UsersRound, org: Building2, community: UsersRound, job: BriefcaseBusiness, course: BookOpen, event: CalendarDays, post: FileText } as const
const SECTION_ORDER: readonly SearchKind[] = ['person', 'post', 'job', 'org', 'community', 'course', 'event']

export function parseSearchTab(value: string | string[] | undefined): SearchTab {
  const raw = Array.isArray(value) ? value[0] : value
  return (SEARCH_TABS as readonly string[]).includes(raw ?? '') ? raw as SearchTab : 'all'
}

function tabHref(query: string, tab: SearchTab, page = 1) {
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  if (tab !== 'all') params.set('type', tab)
  if (page > 1) params.set('page', String(page))
  return `/search?${params.toString()}`
}

function Highlighted({ text, query }: { text: string; query: string }) {
  return <>{highlightParts(text, query).map((part, index) => (part.match ? <mark key={index} className="bg-teal-50 font-semibold text-navy-950">{part.text}</mark> : <span key={index}>{part.text}</span>))}</>
}

function ResultRow({ hit, query, avatarUrl }: { hit: SearchHit; query: string; avatarUrl: string | null }) {
  const Icon = KIND_ICON[hit.kind]
  const age = hit.kind === 'post' && hit.createdAt ? relativeTimeFrom(hit.createdAt) : null
  return (
    <li>
      <Link href={hrefFor(hit)} className="flex min-h-16 items-start gap-3 py-3 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ocean-500">
        {avatarUrl ? (
          <MediaImage src={avatarUrl} alt="" width={48} height={48} sizes="48px" className="size-12 shrink-0 rounded-xl object-cover" fallback={<span className="size-12" />} />
        ) : (
          <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700"><Icon className="size-5" /></span>
        )}
        <span className="min-w-0 flex-1">
          {hit.kind === 'post' ? (
            <>
              <span className="block text-sm font-semibold text-navy-950">{hit.name}{age ? <span className="font-normal text-muted"> · {age}</span> : null}</span>
              <span className="mt-0.5 line-clamp-2 text-sm leading-6 text-ink"><Highlighted text={hit.subtitle ?? ''} query={query} /></span>
            </>
          ) : (
            <>
              <span className="block truncate text-[15px] font-semibold text-navy-950"><Highlighted text={hit.name} query={query} /></span>
              {hit.subtitle ? <span className="block truncate text-[13px] text-muted">{hit.subtitle}</span> : null}
            </>
          )}
        </span>
      </Link>
    </li>
  )
}

export async function SearchV2({ viewerId, query, tab, page, category = null }: { viewerId: string; query: string; tab: SearchTab; page: number; category?: string | null }) {
  // Round I (I2): on the Communities tab, the category facet; a chosen category lists that category's matches.
  const facet = query && tab === 'communities' ? await communityRepository.countSearchGroupsByCategory(query).catch(() => []) : []
  const filtered = query && tab === 'communities' && category
    ? await communityRepository.searchGroups(viewerId, query, SEARCH_WEIGHTS.pageSize, category).catch(() => [])
    : null
  const result = query && !filtered ? await searchService.page(viewerId, query, tab, page) : null
  const groups: Partial<Record<SearchKind, SearchHit[]>> = filtered
    ? { community: filtered.map((group) => ({ kind: 'community' as const, id: group.id, name: group.name, subtitle: group.category?.name ?? null, slug: group.slug, avatarPath: null, ownerId: null, score: 0, createdAt: null })) }
    : result?.groups ?? {}
  const peopleHits = groups.person ?? []
  const otherHits = SECTION_ORDER.filter((kind) => kind !== 'person').flatMap((kind) => groups[kind] ?? [])
  const [people, avatars] = await Promise.all([
    getNetworkProfilesByIds(peopleHits.map((hit) => hit.id)).catch(() => []),
    Promise.all(otherHits.map(async (hit) => [`${hit.kind}:${hit.id}`, hit.avatarPath ? await createMediaImageSrc(hit.avatarPath).catch(() => null) : null] as const)),
  ])
  const avatarByKey = new Map(avatars)
  const sections = tab === 'all' ? SECTION_ORDER : [TAB_KIND[tab]]
  const total = filtered ? filtered.length : result?.total ?? 0

  return (
    <section className="mx-auto w-full max-w-page-wide py-2 max-md:py-0 sm:py-5">
      <h1 className="sr-only">Search</h1>
      <div className="flex items-center gap-2 max-md:-mx-4 max-md:border-b max-md:border-mist-100 max-md:bg-white max-md:px-4 max-md:py-2">
        <Link href="/home" aria-label="Back" className="-ml-2 grid size-11 shrink-0 place-items-center rounded-full text-navy-900 hover:bg-mist-50 md:hidden">
          <ArrowLeft aria-hidden="true" className="size-5" />
        </Link>
        <div className="min-w-0 flex-1"><LivePageSearch initialQuery={query} tab={tab} resultCount={total} autoFocus={!query} /></div>
      </div>
      <nav aria-label="Search tabs" className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 max-md:mt-0 max-md:border-b max-md:border-mist-100 max-md:bg-white max-md:py-2">
        {SEARCH_TABS.map((value) => (
          <Link
            key={value}
            href={tabHref(query, value)}
            aria-current={tab === value ? 'page' : undefined}
            className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-mist-300 bg-white px-3.5 text-sm font-semibold text-navy-700 hover:bg-mist-50 aria-[current=page]:border-navy-950 aria-[current=page]:bg-navy-950 aria-[current=page]:text-white"
          >
            {TAB_LABELS[value]}
          </Link>
        ))}
      </nav>
      {!query ? (
        <p className="mt-6 rounded-2xl border border-dashed border-mist-200 bg-white px-6 py-10 text-center text-sm text-muted">
          Start typing a name, rank (2/O, C/E, ETO), company, vessel type, course or topic. Results appear as you type.
        </p>
      ) : (
        <div className="mt-4 space-y-6 max-md:mt-0 max-md:space-y-2">
          <p data-testid="search-result-count" className="text-sm text-muted max-md:pt-2">
            {!total
              ? `No results for “${query}”. Try fewer letters, a rank like 2/O, or another tab.`
              : tab === 'all'
                ? `Top matches for “${query}”`
                : `${(page - 1) * 20 + total}${result?.hasMore ? '+' : ''} result${total === 1 ? '' : 's'} for “${query}”`}
          </p>
          {tab === 'communities' ? (
            <CommunityCategoryFacet
              chips={facet}
              active={category}
              hrefFor={(slug) => {
                const next = new URLSearchParams({ q: query, type: 'communities' })
                if (slug) next.set('category', slug)
                return `/search?${next.toString()}`
              }}
            />
          ) : null}
          {result?.partial ? <p role="status" className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-900">Search took too long; showing what was ready. Keep typing or try again.</p> : null}
          {sections.map((kind) => {
            const hits = groups[kind] ?? []
            if (!hits.length) return null
            const headingId = `search-section-${kind}`
            return (
              <section key={kind} aria-labelledby={headingId} className="rounded-2xl border border-mist-100 bg-white px-4 py-3 max-md:-mx-4 max-md:rounded-none max-md:border-x-0">
                <div className="flex items-center justify-between gap-2">
                  <h2 id={headingId} className="text-base font-bold text-navy-950">{TAB_LABELS[KIND_TAB[kind]]}</h2>
                  {tab === 'all' && hits.length >= ALL_TAB_LIMITS[kind] ? (
                    <Link href={tabHref(query, KIND_TAB[kind])} className="inline-flex min-h-10 items-center text-sm font-semibold text-ocean-700 hover:underline">See all {TAB_LABELS[KIND_TAB[kind]].toLowerCase()}</Link>
                  ) : null}
                </div>
                <ul className="divide-y divide-mist-100">
                  {kind === 'person'
                    ? people.map((profile) => <SearchPersonRow key={profile.id} profile={profile} className="!pt-3" />)
                    : hits.map((hit) => <ResultRow key={hit.id} hit={hit} query={query} avatarUrl={avatarByKey.get(`${hit.kind}:${hit.id}`) ?? null} />)}
                </ul>
              </section>
            )
          })}
          {tab !== 'all' && (page > 1 || result?.hasMore) ? (
            <nav aria-label="Result pages" className="flex items-center justify-between gap-3">
              {page > 1 ? <Link rel="prev" href={tabHref(query, tab, page - 1)} className="inline-flex min-h-11 items-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50">Previous</Link> : <span />}
              <span className="text-sm text-muted">Page {page}</span>
              {result?.hasMore ? <Link rel="next" href={tabHref(query, tab, page + 1)} className="inline-flex min-h-11 items-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50">Next</Link> : <span />}
            </nav>
          ) : null}
        </div>
      )}
    </section>
  )
}
