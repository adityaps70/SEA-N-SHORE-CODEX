import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, ChevronRight, Plus, Search } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  CommunityCategoryGrid,
  CommunityDiscoverCard,
  CommunityListRow,
  communityHref,
} from '@/features/community/components/community-discover'
import { GroupCard } from '@/features/community/components/group-card'
import { communityRepository } from '@/features/community/repository'
import { communityService } from '@/features/community/service'
import {
  COMMUNITY_CATEGORIES,
  COMMUNITY_CATEGORY_LABELS,
  DIRECTORY_SORTS,
  DIRECTORY_SORT_LABELS,
  isCommunityCategory,
  type CommunityCategory,
  type CommunityGroup,
  type DirectorySort,
  type GroupJoinPolicy,
} from '@/features/community/types'
import { pluralize } from '@/lib/format'

export const metadata: Metadata = { title: 'Community' }

/** Directory page size behind "Browse all". */
const DIRECTORY_PAGE_SIZE = 24
/** How many of the member's own communities the landing page lists before "See all". */
const YOUR_COMMUNITIES_PREVIEW = 6
const SUGGESTED_COUNT = 6
const POPULAR_COUNT = 5

type SearchParams = Record<string, string | string[] | undefined>

function readSingle(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ''
}

function readPage(value: string | string[] | undefined) {
  const page = Number.parseInt(readSingle(value), 10)
  return Number.isFinite(page) && page > 1 ? Math.min(page, 1000) : 1
}

function SectionHeader({ id, title, description, action }: { id: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="text-lg font-bold text-navy-950 max-md:text-[17px]">{title}</h2>
        {/* Phones: section intros are hidden (no page intros on phones). */}
        {description ? <p className="mt-0.5 max-w-3xl text-sm leading-6 text-muted max-md:hidden">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-mist-100 bg-white px-4 shadow-[var(--shadow-card)] max-md:shadow-none ${className}`}>{children}</div>
}

function GroupGrid({ groups, label }: { groups: CommunityGroup[]; label: string }) {
  return (
    <ul aria-label={label} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 max-md:gap-2">
      {groups.map((group) => <li key={group.id} className="min-w-0"><GroupCard group={group} /></li>)}
    </ul>
  )
}

function SearchForm({ query, hidden }: { query: string; hidden?: Record<string, string> }) {
  return (
    <form action="/community" method="get" role="search" className="relative w-full md:w-72">
      <label htmlFor="community-search" className="sr-only">Search communities</label>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input
        id="community-search"
        name="q"
        type="search"
        defaultValue={query}
        maxLength={100}
        placeholder="Search communities"
        className="min-h-11 w-full rounded-xl border border-mist-200 bg-white pl-9 pr-3 text-sm text-ink outline-none placeholder:text-muted focus:border-ocean-500 focus:ring-2 focus:ring-ocean-100"
      />
      {Object.entries(hidden ?? {}).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
    </form>
  )
}

function PageHeader({ query, title, back, hidden }: { query: string; title: string; back?: boolean; hidden?: Record<string, string> }) {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {back ? (
          <Link href="/community" className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-ocean-700 hover:underline">
            <ArrowLeft aria-hidden="true" className="size-4" /> Communities
          </Link>
        ) : (
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-800 max-md:hidden">Professional Communities</p>
        )}
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy-950 max-md:mt-0 max-md:text-[22px]">{title}</h1>
        {!back ? (
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted max-md:hidden">
            Focused spaces where seafarers, shore professionals, trainers and students discuss real work, share lessons and build trusted relationships.
          </p>
        ) : null}
      </div>
      <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
        <SearchForm query={query} hidden={hidden} />
        {/* Round 9C: always shown; /community/new explains Creator Pro / Organization Pro when the member cannot create yet. */}
        <Link href="/community/new" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-navy-950 px-4 text-sm font-bold text-white transition hover:bg-navy-900 max-md:w-full max-md:rounded-full">
          <Plus aria-hidden="true" className="size-4" strokeWidth={2.5} /> Create a community
        </Link>
      </div>
    </header>
  )
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={active
        ? 'inline-flex min-h-9 shrink-0 items-center rounded-full bg-navy-950 px-3.5 text-sm font-semibold text-white'
        : 'inline-flex min-h-9 shrink-0 items-center rounded-full border border-mist-200 bg-white px-3.5 text-sm font-semibold text-navy-900 hover:border-ocean-300 hover:bg-ocean-50'}
    >
      {children}
    </Link>
  )
}

/** Suggestions first (rank, vessel types, persona), then the most active communities the member has not joined. */
function pickSuggestions(suggested: CommunityGroup[], popular: CommunityGroup[], popularShown: CommunityGroup[]) {
  const seen = new Set<string>()
  const result: CommunityGroup[] = []
  const shownIds = new Set(popularShown.map((group) => group.id))
  const add = (group: CommunityGroup) => {
    if (seen.has(group.id) || result.length >= SUGGESTED_COUNT) return
    const status = group.viewerMembership?.status
    if (status === 'active' || status === 'pending') return
    seen.add(group.id)
    result.push(group)
  }
  suggested.forEach(add)
  popular.filter((group) => !shownIds.has(group.id)).forEach(add)
  if (result.length < 3) popular.forEach(add)
  return result
}

type DiscoverData = {
  mine: CommunityGroup[]
  suggestedBySignals: CommunityGroup[]
  active: CommunityGroup[]
  categoryCounts: Partial<Record<CommunityCategory, number>>
}

async function loadDiscover(viewerId: string): Promise<DiscoverData> {
  const [mine, suggestedBySignals, activePage, categoryCounts] = await Promise.all([
    communityRepository.listViewerGroups(viewerId),
    communityService.suggestGroups(viewerId).catch((): CommunityGroup[] => []),
    communityRepository.browseDirectory(viewerId, { notJoined: true, sort: 'active', limit: 12 }).catch(() => ({ groups: [] as CommunityGroup[], total: 0 })),
    communityRepository.countByCategory().catch((): Partial<Record<CommunityCategory, number>> => ({})),
  ])
  return { mine, suggestedBySignals, active: activePage.groups, categoryCounts }
}

function DiscoverView({ mine, suggestedBySignals, active, categoryCounts }: DiscoverData) {
  const popular = active.slice(0, POPULAR_COUNT)
  const suggested = pickSuggestions(suggestedBySignals, active, popular)
  const nothingYet = !mine.length && !suggested.length && !popular.length

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] max-md:gap-3">
      {/* Your communities: the right rail on desktop, first on phones. */}
      <aside aria-labelledby="your-communities-heading" className="min-w-0 lg:order-2">
        <div className="lg:sticky lg:top-20">
          <SectionHeader
            id="your-communities-heading"
            title="Your communities"
            action={mine.length > YOUR_COMMUNITIES_PREVIEW
              ? <Link href={communityHref({ view: 'mine' })} className="text-sm font-semibold text-ocean-700 hover:underline">See all {mine.length}</Link>
              : null}
          />
          <Panel>
            {mine.length ? (
              <ul aria-label="Your communities" className="divide-y divide-mist-100">
                {mine.slice(0, YOUR_COMMUNITIES_PREVIEW).map((group) => <li key={group.id}><CommunityListRow group={group} /></li>)}
              </ul>
            ) : (
              <p className="py-4 text-sm leading-6 text-muted">You have not joined a community yet. Join one below to see its posts in your feed.</p>
            )}
          </Panel>
        </div>
      </aside>

      <div className="min-w-0 space-y-6 max-md:space-y-4">
        {suggested.length ? (
          <section aria-labelledby="suggested-communities-heading">
            <SectionHeader id="suggested-communities-heading" title="Suggested for you" description="Picked from your rank, vessel types and role, and what is active on Sea N Shore." />
            <ul aria-label="Suggested communities" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 max-md:gap-2">
              {suggested.map((group) => <li key={group.id} className="min-w-0"><CommunityDiscoverCard group={group} /></li>)}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="community-categories-heading">
          <SectionHeader id="community-categories-heading" title="Browse by category" />
          <CommunityCategoryGrid counts={categoryCounts} />
        </section>

        {popular.length ? (
          <section aria-labelledby="popular-communities-heading">
            <SectionHeader id="popular-communities-heading" title="Popular this week" description="The most active communities you have not joined yet." />
            <Panel>
              <ul aria-label="Popular communities" className="divide-y divide-mist-100">
                {popular.map((group) => <li key={group.id}><CommunityListRow group={group} showAction /></li>)}
              </ul>
            </Panel>
          </section>
        ) : null}

        {nothingYet ? (
          <div className="rounded-2xl border border-dashed border-mist-200 bg-white px-5 py-10 text-center text-sm text-muted">
            No groups yet. Create the first community with Creator Pro or Organization Pro.
          </div>
        ) : null}

        <Link
          href={communityHref({ view: 'all' })}
          className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-mist-100 bg-white px-4 text-sm font-bold text-navy-950 shadow-[var(--shadow-card)] transition hover:border-ocean-200 hover:bg-ocean-50 max-md:shadow-none"
        >
          Browse all communities
          <ChevronRight aria-hidden="true" className="size-4 text-muted" />
        </Link>
      </div>
    </div>
  )
}

type DirectoryFilters = {
  query: string
  category: CommunityCategory | null
  joinPolicy: GroupJoinPolicy | null
  sort: DirectorySort
  page: number
}

function DirectoryView({ query, category, joinPolicy, sort, page, groups, total }: DirectoryFilters & { groups: CommunityGroup[]; total: number }) {
  const totalPages = Math.max(1, Math.ceil(total / DIRECTORY_PAGE_SIZE))
  const base = { view: 'all', q: query || null, category, join: joinPolicy, sort: sort === 'active' ? null : sort }
  const href = (changes: Record<string, string | number | null>) => communityHref({ ...base, page: null, ...changes })
  const title = query
    ? `Communities matching “${query}”`
    : category ? COMMUNITY_CATEGORY_LABELS[category] : 'All communities'

  return (
    <section aria-labelledby="directory-heading" className="space-y-4 max-md:space-y-3">
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="directory-heading" className="text-lg font-bold text-navy-950 max-md:text-[17px]">{title}</h2>
          <p className="text-sm text-muted">
            {pluralize(total, 'community', 'communities')}{totalPages > 1 ? ` · Page ${Math.min(page, totalPages)} of ${totalPages}` : ''}
          </p>
        </div>
        <nav aria-label="Filter by category" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
          <FilterChip href={href({ category: null })} active={!category}>All</FilterChip>
          {COMMUNITY_CATEGORIES.map((value) => (
            <FilterChip key={value} href={href({ category: value })} active={category === value}>{COMMUNITY_CATEGORY_LABELS[value]}</FilterChip>
          ))}
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Filter by join setting" className="flex flex-wrap gap-2">
            <FilterChip href={href({ join: null })} active={!joinPolicy}>Any</FilterChip>
            <FilterChip href={href({ join: 'open' })} active={joinPolicy === 'open'}>Open to join</FilterChip>
            <FilterChip href={href({ join: 'approval' })} active={joinPolicy === 'approval'}>Approval required</FilterChip>
          </nav>
          <form action="/community" method="get" className="flex items-center gap-2 text-sm">
            <input type="hidden" name="view" value="all" />
            {query ? <input type="hidden" name="q" value={query} /> : null}
            {category ? <input type="hidden" name="category" value={category} /> : null}
            {joinPolicy ? <input type="hidden" name="join" value={joinPolicy} /> : null}
            <label htmlFor="community-sort" className="text-muted">Sort</label>
            <select id="community-sort" name="sort" defaultValue={sort} className="min-h-9 rounded-lg border border-mist-200 bg-white px-2 text-sm text-navy-950 outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-100">
              {DIRECTORY_SORTS.map((value) => <option key={value} value={value}>{DIRECTORY_SORT_LABELS[value]}</option>)}
            </select>
            <button type="submit" className="min-h-9 rounded-lg border border-mist-200 bg-white px-3 text-xs font-semibold text-navy-950 hover:border-ocean-200 hover:bg-ocean-50">Apply</button>
          </form>
        </div>
      </div>

      {groups.length ? (
        <GroupGrid groups={groups} label="Communities" />
      ) : (
        <div className="rounded-2xl border border-dashed border-mist-200 bg-white px-5 py-10 text-center text-sm text-muted">
          {query ? `No groups match “${query}”. Try another word or browse all groups.` : 'No communities match these filters yet.'}
        </div>
      )}

      {totalPages > 1 ? (
        <nav aria-label="Community pages" className="flex items-center justify-between gap-3">
          {page > 1
            ? <Link href={href({ page: page - 1 > 1 ? page - 1 : null })} rel="prev" className="inline-flex min-h-10 items-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 hover:border-ocean-200 hover:bg-ocean-50">Previous</Link>
            : <span aria-disabled="true" className="inline-flex min-h-10 items-center rounded-xl border border-mist-100 px-4 text-sm font-semibold text-muted">Previous</span>}
          <p className="text-sm font-medium text-muted">Page {Math.min(page, totalPages)} of {totalPages}</p>
          {page < totalPages
            ? <Link href={href({ page: page + 1 })} rel="next" className="inline-flex min-h-10 items-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 hover:border-ocean-200 hover:bg-ocean-50">Next</Link>
            : <span aria-disabled="true" className="inline-flex min-h-10 items-center rounded-xl border border-mist-100 px-4 text-sm font-semibold text-muted">Next</span>}
        </nav>
      ) : null}
    </section>
  )
}

function YourCommunitiesView({ mine }: { mine: CommunityGroup[] }) {
  return (
    <section aria-labelledby="all-your-communities-heading">
      <SectionHeader id="all-your-communities-heading" title="Your communities" description="Communities you belong to, and requests waiting for a moderator." />
      {mine.length ? (
        <GroupGrid groups={mine} label="Your communities" />
      ) : (
        <div className="rounded-2xl border border-dashed border-mist-200 bg-white px-5 py-10 text-center text-sm text-muted">
          You have not joined a community yet. <Link href={communityHref({ view: 'all' })} className="font-semibold text-ocean-700 hover:underline">Browse all communities</Link>
        </div>
      )}
    </section>
  )
}

/**
 * Round 10: LinkedIn Groups style. The landing view shows the member's own communities,
 * suggestions, categories and what is popular this week; the full directory only appears behind
 * "Browse all", a category or a search, one page at a time with filters.
 */
export default async function CommunityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const query = readSingle(params.q).slice(0, 100)
  const view = readSingle(params.view)
  const rawCategory = readSingle(params.category)
  const category = isCommunityCategory(rawCategory) ? rawCategory : null
  const rawJoin = readSingle(params.join)
  const joinPolicy: GroupJoinPolicy | null = rawJoin === 'open' || rawJoin === 'approval' ? rawJoin : null
  const rawSort = readSingle(params.sort)
  const sort: DirectorySort = (DIRECTORY_SORTS as readonly string[]).includes(rawSort) ? rawSort as DirectorySort : 'active'
  const page = readPage(params.page)
  const user = await requireAwsUser()

  const mode = view === 'mine' ? 'mine' : query || view === 'all' || category || joinPolicy ? 'directory' : 'discover'
  const filters: DirectoryFilters = { query, category, joinPolicy, sort, page }
  const [discover, directory, mine] = await Promise.all([
    mode === 'discover' ? loadDiscover(user.id) : null,
    mode === 'directory'
      ? communityRepository.browseDirectory(user.id, {
        search: query,
        category,
        joinPolicy,
        sort,
        limit: DIRECTORY_PAGE_SIZE,
        offset: (page - 1) * DIRECTORY_PAGE_SIZE,
      })
      : null,
    mode === 'mine' ? communityRepository.listViewerGroups(user.id) : null,
  ])

  return (
    <section className="space-y-6 py-2 max-md:space-y-3 max-md:py-0 sm:py-4">
      <PageHeader
        query={query}
        title={mode === 'discover' ? 'Communities' : mode === 'mine' ? 'Your communities' : 'Browse communities'}
        back={mode !== 'discover'}
        hidden={mode === 'directory' ? { view: 'all', ...(category ? { category } : {}), ...(joinPolicy ? { join: joinPolicy } : {}) } : undefined}
      />
      {discover ? <DiscoverView {...discover} /> : null}
      {directory ? <DirectoryView {...filters} groups={directory.groups} total={directory.total} /> : null}
      {mine ? <YourCommunitiesView mine={mine} /> : null}
    </section>
  )
}
