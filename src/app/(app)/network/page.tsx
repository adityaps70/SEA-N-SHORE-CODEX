import { Search, UsersRound } from 'lucide-react'
import { ConnectionRequestCard } from '@/features/network/components/connection-request-card'
import { NetworkProfileCard } from '@/features/network/components/network-profile-card'
import { NetworkTabs } from '@/features/network/components/network-tabs'
import { getNetworkHub } from '@/features/network/queries'
import { parseNetworkTab } from '@/features/network/schemas'

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
    title: 'You are not following anyone yet.',
    body: 'Follow professionals whose experience, knowledge, or career journey you want to keep up with.',
  },
} as const

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-5 rounded-[1.5rem] border border-dashed border-mist-100 bg-white px-6 py-12 text-center">
      <p className="font-semibold text-navy-950">{title}</p>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">{body}</p>
    </div>
  )
}

export default async function NetworkPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>
}) {
  const { tab: tabValue, q: rawQuery } = await searchParams
  const tab = parseNetworkTab(tabValue)
  const query = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, 100) : ''
  const hub = await getNetworkHub(tab, tab === 'discover' ? query : '')

  return (
    <section className="py-2 sm:py-5">
      <div className="rounded-[1.75rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-8">
        <div className="flex items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-navy-950 text-white">
            <UsersRound aria-hidden="true" className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Maritime network</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] text-navy-950">People worth knowing at sea and ashore.</h1>
            <p className="mt-2 max-w-2xl leading-7 text-muted">
              Build professional relationships across ships, shore offices, training, recruitment, mentoring, and the wider maritime ecosystem.
            </p>
          </div>
        </div>

        <form action="/network" method="get" role="search" className="relative mt-6 max-w-2xl">
          <input type="hidden" name="tab" value="discover" />
          <label htmlFor="network-search" className="sr-only">Search maritime professionals</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            id="network-search"
            name="q"
            type="search"
            defaultValue={query}
            maxLength={100}
            placeholder="Search by name, rank, company, location, vessel type or skill"
            className="min-h-12 w-full rounded-xl border border-mist-100 bg-mist-50 py-3 pl-11 pr-4 text-sm text-ink outline-none placeholder:text-muted focus:border-ocean-700 focus:bg-white"
          />
        </form>
      </div>

      <NetworkTabs active={tab} incomingRequestCount={hub.incomingRequestCount} />

      {tab === 'requests' ? (
        <div className="mt-5 space-y-7">
          <section aria-labelledby="received-requests-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.12em] text-ocean-700">Invitations</p>
                <h2 id="received-requests-heading" className="mt-1 text-xl font-semibold text-navy-950">Requests for you</h2>
              </div>
              {hub.receivedRequests.length ? <span className="text-sm font-medium text-muted">{hub.receivedRequests.length} pending</span> : null}
            </div>
            {hub.receivedRequests.length ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {hub.receivedRequests.map((profile) => <ConnectionRequestCard key={profile.id} profile={profile} direction="incoming" />)}
              </div>
            ) : (
              <EmptyState title="No connection requests are waiting." body="New invitations from maritime professionals will appear here." />
            )}
          </section>

          <section aria-labelledby="sent-requests-heading">
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-ocean-700">Outgoing</p>
            <h2 id="sent-requests-heading" className="mt-1 text-xl font-semibold text-navy-950">Requests you sent</h2>
            {hub.sentRequests.length ? (
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                {hub.sentRequests.map((profile) => <ConnectionRequestCard key={profile.id} profile={profile} direction="sent" />)}
              </div>
            ) : (
              <EmptyState title="You have no pending sent requests." body="When you invite someone to connect, the request will remain here until it is accepted, declined, or cancelled." />
            )}
          </section>
        </div>
      ) : hub.profiles.length ? (
        <div className="mt-5">
          {tab === 'discover' && query ? (
            <p className="mb-3 text-sm text-muted">{hub.profiles.length} result{hub.profiles.length === 1 ? '' : 's'} for <span className="font-semibold text-navy-950">“{query}”</span></p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {hub.profiles.map((profile) => <NetworkProfileCard key={profile.id} profile={profile} />)}
          </div>
        </div>
      ) : tab === 'discover' && query ? (
        <EmptyState title={`No professionals found for “${query}”.`} body="Try a name, rank, company, location, vessel type, trading area, or professional skill." />
      ) : (
        <EmptyState title={emptyCopy[tab].title} body={emptyCopy[tab].body} />
      )}
    </section>
  )
}
