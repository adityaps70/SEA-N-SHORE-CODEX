import Link from 'next/link'
import { Search } from 'lucide-react'
import { PremiumPageHero } from '@/components/product/premium-page-hero'
import { ConnectionRequestCard } from '@/features/network/components/connection-request-card'
import { NetworkPersonListRow } from '@/features/network/components/network-person-list-row'
import { NetworkProfileCard } from '@/features/network/components/network-profile-card'
import { NetworkTabs } from '@/features/network/components/network-tabs'
import { getNetworkHub } from '@/features/network/queries'
import { parseNetworkTab } from '@/features/network/schemas'
import type { NetworkFollowView, NetworkProfile } from '@/features/network/types'

const emptyCopy = {
  discover: {
    title: 'No new professionals to recommend yet.',
    body: 'As more maritime professionals complete their profiles, relevant people will appear here.',
  },
  connections: {
    title: 'Your first professional connection is waiting to happen.',
    body: 'Discover seafarers and maritime professionals, then send a connection request to build your network.',
  },
  following: {
    title: 'No professionals to show here yet.',
    body: 'Follow maritime professionals whose experience, knowledge, or career journey you want to keep up with.',
  },
} as const

function EmptyState({ title, body, compact = false }: { title: string; body: string; compact?: boolean }) {
  return (
    <div className={compact ? 'px-6 py-10 text-center' : 'mt-5 rounded-[1.5rem] border border-dashed border-mist-100 bg-white px-6 py-12 text-center'}>
      <p className="font-semibold text-navy-950">{title}</p>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">{body}</p>
    </div>
  )
}

function sortProfiles(profiles: NetworkProfile[], sort: string) {
  if (sort !== 'name') return profiles
  return [...profiles].sort((left, right) => left.fullName.localeCompare(right.fullName))
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function SearchField({
  tab,
  query,
  sort,
  view,
  ariaLabel,
  placeholder,
}: {
  tab: string
  query: string
  sort?: string
  view?: string
  ariaLabel: string
  placeholder: string
}) {
  return (
    <form action="/network" method="get" role="search" className="flex w-full max-w-xl items-center gap-2">
      <input type="hidden" name="tab" value={tab} />
      {sort ? <input type="hidden" name="sort" value={sort} /> : null}
      {view ? <input type="hidden" name="view" value={view} /> : null}
      <div className="relative flex-1">
        <label htmlFor={`network-search-${tab}`} className="sr-only">{ariaLabel}</label>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          id={`network-search-${tab}`}
          name="q"
          type="search"
          defaultValue={query}
          maxLength={100}
          placeholder={placeholder}
          className="min-h-11 w-full rounded-xl border border-mist-100 bg-white py-2.5 pl-10 pr-3 text-sm text-ink outline-none placeholder:text-muted focus:border-ocean-400"
        />
      </div>
      <button type="submit" className="min-h-11 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-ocean-700">Search</button>
    </form>
  )
}

export default async function NetworkPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; view?: string; sort?: string }>
}) {
  const { tab: tabValue, q: rawQuery, view: rawView, sort: rawSort } = await searchParams
  const tab = parseNetworkTab(tabValue)
  const query = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, 100) : ''
  const sort = rawSort === 'name' ? 'name' : 'recent'
  const followView: NetworkFollowView = rawView === 'followers' ? 'followers' : 'following'
  const requestView = rawView === 'sent' ? 'sent' : 'received'
  const hub = await getNetworkHub(tab, query, followView)
  const profiles = sortProfiles(hub.profiles, sort)

  return (
    <section className="py-2 sm:py-5">
      <PremiumPageHero
        eyebrow="Maritime network"
        title="People worth knowing at sea and ashore."
        description="Discover trusted maritime professionals by rank, company, location, vessel experience and specialist skills."
      >
        {tab === 'discover' ? (
          <form action="/network" method="get" role="search" className="relative mt-6 max-w-2xl rounded-2xl bg-white p-2">
            <input type="hidden" name="tab" value="discover" />
            <label htmlFor="network-search" className="sr-only">Search maritime professionals</label>
            <Search aria-hidden="true" className="pointer-events-none absolute left-6 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              id="network-search"
              name="q"
              type="search"
              defaultValue={query}
              maxLength={100}
              placeholder="Search by name, rank, company, location, vessel type or skill"
              className="min-h-12 w-full rounded-xl bg-mist-50 py-3 pl-11 pr-4 text-sm text-ink outline-none placeholder:text-muted focus:bg-white focus:ring-1 focus:ring-teal-200"
            />
          </form>
        ) : null}
      </PremiumPageHero>

      <NetworkTabs active={tab} incomingRequestCount={hub.incomingRequestCount} />

      {tab === 'discover' ? (
        profiles.length ? (
          <section className="mt-5 overflow-hidden rounded-2xl border border-mist-100 bg-white shadow-sm" aria-labelledby="people-you-may-know-heading">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-mist-100 px-5 py-4">
              <div>
                <h2 id="people-you-may-know-heading" className="text-xl font-semibold text-navy-950">People you may know</h2>
                <p className="mt-1 text-sm text-muted">
                  {query ? `${profiles.length} relevant result${profiles.length === 1 ? '' : 's'} for “${query}”.` : 'Recommended maritime professionals based on your profile and network.'}
                </p>
              </div>
              {query ? <Link href="/network?tab=discover" className="text-sm font-semibold text-ocean-700 hover:text-navy-950">Clear search</Link> : null}
            </div>
            <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {profiles.map((profile) => <NetworkProfileCard key={profile.id} profile={profile} />)}
            </div>
          </section>
        ) : query ? (
          <EmptyState title={`No professionals found for “${query}”.`} body="Try a name, rank, company, location, vessel type, trading area, or professional skill." />
        ) : (
          <EmptyState title={emptyCopy.discover.title} body={emptyCopy.discover.body} />
        )
      ) : null}

      {tab === 'connections' ? (
        <section className="mt-5 overflow-hidden rounded-2xl border border-mist-100 bg-white shadow-sm" aria-labelledby="connections-heading">
          <div className="border-b border-mist-100 px-5 py-4 sm:px-6">
            <h2 id="connections-heading" className="text-xl font-semibold text-navy-950">{countLabel(hub.totalCount, 'connection')}</h2>
            <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted">Sort by:</span>
                <details className="relative">
                  <summary className="cursor-pointer list-none font-semibold text-navy-950">
                    {sort === 'name' ? 'Name' : 'Recently added'}
                  </summary>
                  <div className="absolute left-0 z-20 mt-2 min-w-44 rounded-xl border border-mist-100 bg-white p-1 shadow-lg">
                    <Link href={`/network?tab=connections&q=${encodeURIComponent(query)}&sort=recent`} className="block rounded-lg px-3 py-2 text-sm font-medium text-navy-900 hover:bg-mist-50">Recently added</Link>
                    <Link href={`/network?tab=connections&q=${encodeURIComponent(query)}&sort=name`} className="block rounded-lg px-3 py-2 text-sm font-medium text-navy-900 hover:bg-mist-50">Name A–Z</Link>
                  </div>
                </details>
              </div>
              <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                <SearchField tab="connections" query={query} sort={sort} ariaLabel="Search connections" placeholder="Search by name" />
                <span className="text-xs font-semibold text-ocean-700">Search also matches rank, company & location</span>
              </div>
            </div>
          </div>

          {profiles.length ? (
            <div className="divide-y divide-mist-100">
              {profiles.map((profile) => <NetworkPersonListRow key={profile.id} profile={profile} kind="connection" />)}
            </div>
          ) : query ? (
            <EmptyState compact title={`No connections found for “${query}”.`} body="Try another name, rank, company or location." />
          ) : (
            <EmptyState compact title={emptyCopy.connections.title} body={emptyCopy.connections.body} />
          )}
        </section>
      ) : null}

      {tab === 'following' ? (
        <section className="mt-5 overflow-hidden rounded-2xl border border-mist-100 bg-white shadow-sm" aria-labelledby="network-follow-heading">
          <div className="border-b border-mist-100 px-5 py-4 sm:px-6">
            <h2 id="network-follow-heading" className="text-xl font-semibold text-navy-950">Your Network</h2>
          </div>
          <nav aria-label="Following and followers" className="flex gap-8 border-b border-mist-100 px-5 sm:px-6">
            {(['following', 'followers'] as const).map((view) => (
              <Link
                key={view}
                href={`/network?tab=following&view=${view}`}
                aria-current={followView === view ? 'page' : undefined}
                className="border-b-2 border-transparent py-4 text-sm font-semibold capitalize text-muted hover:text-navy-950 aria-[current=page]:border-ocean-600 aria-[current=page]:text-navy-950"
              >
                {view === 'following' ? 'Following' : 'Followers'}
              </Link>
            ))}
          </nav>
          <div className="flex flex-col gap-3 border-b border-mist-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between sm:px-6">
            <p className="text-sm text-muted">
              {followView === 'following'
                ? `You are following ${hub.totalCount} ${hub.totalCount === 1 ? 'person' : 'people'} in your maritime network.`
                : `${hub.totalCount} ${hub.totalCount === 1 ? 'person follows' : 'people follow'} you in the maritime community.`}
            </p>
            <SearchField tab="following" query={query} view={followView} ariaLabel={followView === 'following' ? 'Search following' : 'Search followers'} placeholder={followView === 'following' ? 'Search following' : 'Search followers'} />
          </div>

          {profiles.length ? (
            <div className="divide-y divide-mist-100">
              {profiles.map((profile) => (
                <NetworkPersonListRow
                  key={profile.id}
                  profile={profile}
                  kind={followView === 'following' ? 'following' : 'follower'}
                />
              ))}
            </div>
          ) : query ? (
            <EmptyState compact title={`No ${followView} found for “${query}”.`} body="Try another name or professional keyword." />
          ) : (
            <EmptyState compact title={emptyCopy.following.title} body={emptyCopy.following.body} />
          )}
        </section>
      ) : null}

      {tab === 'requests' ? (
        <section className="mt-5 overflow-hidden rounded-2xl border border-mist-100 bg-white shadow-sm" aria-labelledby="invitations-heading">
          <div className="border-b border-mist-100 px-5 py-4 sm:px-6">
            <h2 id="invitations-heading" className="text-xl font-semibold text-navy-950">Invitations</h2>
            <p className="mt-1 text-sm text-muted">Manage people who want to connect with you and requests you have sent.</p>
          </div>
          <nav aria-label="Connection request views" className="flex gap-8 border-b border-mist-100 px-5 sm:px-6">
            <Link
              href="/network?tab=requests&view=received"
              aria-current={requestView === 'received' ? 'page' : undefined}
              className="border-b-2 border-transparent py-4 text-sm font-semibold text-muted hover:text-navy-950 aria-[current=page]:border-ocean-600 aria-[current=page]:text-navy-950"
            >
              Received {hub.receivedRequests.length ? `(${hub.receivedRequests.length})` : ''}
            </Link>
            <Link
              href="/network?tab=requests&view=sent"
              aria-current={requestView === 'sent' ? 'page' : undefined}
              className="border-b-2 border-transparent py-4 text-sm font-semibold text-muted hover:text-navy-950 aria-[current=page]:border-ocean-600 aria-[current=page]:text-navy-950"
            >
              Sent {hub.sentRequests.length ? `(${hub.sentRequests.length})` : ''}
            </Link>
          </nav>

          {requestView === 'received' ? (
            hub.receivedRequests.length ? (
              <div className="divide-y divide-mist-100">
                {hub.receivedRequests.map((profile) => <ConnectionRequestCard key={profile.id} profile={profile} direction="incoming" />)}
              </div>
            ) : (
              <EmptyState compact title="No connection requests are waiting." body="New invitations from maritime professionals will appear here." />
            )
          ) : hub.sentRequests.length ? (
            <div className="divide-y divide-mist-100">
              {hub.sentRequests.map((profile) => <ConnectionRequestCard key={profile.id} profile={profile} direction="sent" />)}
            </div>
          ) : (
            <EmptyState compact title="You have no pending sent requests." body="When you invite someone to connect, the request will remain here until it is accepted, declined, or cancelled." />
          )}
        </section>
      ) : null}
    </section>
  )
}
