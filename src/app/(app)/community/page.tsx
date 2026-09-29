import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { GroupCard } from '@/features/community/components/group-card'
import { communityRepository } from '@/features/community/repository'
import { communityService } from '@/features/community/service'
import type { CommunityGroup } from '@/features/community/types'

export const metadata: Metadata = { title: 'Community' }

function SectionHeader({ id, title, description, meta }: { id: string; title: string; description?: string; meta?: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id={id} className="text-lg font-bold text-navy-950 max-md:text-[17px]">{title}</h2>
        {meta}
      </div>
      {/* Phones: section intros are hidden (no page intros on phones). */}
      {description ? <p className="mt-0.5 max-w-3xl text-sm leading-6 text-muted max-md:hidden">{description}</p> : null}
    </div>
  )
}

function GroupGrid({ groups, label }: { groups: CommunityGroup[]; label: string }) {
  return (
    <ul aria-label={label} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 max-md:gap-2">
      {groups.map((group) => <li key={group.id} className="min-w-0"><GroupCard group={group} /></li>)}
    </ul>
  )
}

export default async function CommunityPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const params = await searchParams
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q
  const query = rawQuery?.trim().slice(0, 100) ?? ''
  const user = await requireAwsUser()
  const [directory, mine, suggested] = await Promise.all([
    communityRepository.listDirectory(user.id, { search: query }),
    communityRepository.listViewerGroups(user.id),
    query ? Promise.resolve([]) : communityService.suggestGroups(user.id).catch((): CommunityGroup[] => []),
  ])
  const publicGroups = directory.filter((group) => group.visibility === 'public')
  const privateGroups = directory.filter((group) => group.visibility === 'private')

  return (
    <section className="space-y-6 py-2 max-md:space-y-3 max-md:py-0 sm:py-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-800 max-md:hidden">Professional Communities</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy-950 max-md:mt-0 max-md:text-[22px]">Community groups</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted max-md:hidden">
            Focused spaces where seafarers, shore professionals, trainers and students discuss real work, share lessons and build trusted relationships. Same professional identity, same feed, no noisy group chats.
          </p>
        </div>
        <form action="/community" method="get" role="search" className="relative w-full md:w-80">
          <label htmlFor="community-search" className="sr-only">Search groups</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            id="community-search"
            name="q"
            type="search"
            defaultValue={query}
            maxLength={100}
            placeholder="Search groups"
            className="min-h-11 w-full rounded-xl border border-mist-200 bg-white pl-9 pr-3 text-sm text-ink outline-none placeholder:text-muted focus:border-ocean-500 focus:ring-2 focus:ring-ocean-100"
          />
        </form>
      </header>

      {!query && mine.length ? (
        <section aria-labelledby="your-groups-heading">
          <SectionHeader id="your-groups-heading" title="Your groups" description="Groups you belong to, and requests waiting for a group admin." />
          <GroupGrid groups={mine} label="Your groups" />
        </section>
      ) : null}

      {!query && suggested.length ? (
        <section aria-labelledby="suggested-groups-heading">
          <SectionHeader id="suggested-groups-heading" title="Suggested for you" description="Picked from your rank, vessel types and role on Sea N Shore." />
          <GroupGrid groups={suggested} label="Suggested groups" />
        </section>
      ) : null}

      <section aria-labelledby="all-groups-heading">
        <SectionHeader
          id="all-groups-heading"
          title={query ? `Groups matching “${query}”` : 'All groups'}
          meta={<span className="text-sm text-muted">{directory.length} {directory.length === 1 ? 'group' : 'groups'}</span>}
          description="Public groups are open to every member. Private groups need a group admin to approve your request; their posts and members are visible to members only."
        />
        {directory.length ? (
          <div className="space-y-4 max-md:space-y-2">
            {publicGroups.length ? <GroupGrid groups={publicGroups} label="Public groups" /> : null}
            {privateGroups.length ? (
              <>
                {publicGroups.length ? <h3 className="pt-2 text-sm font-bold uppercase tracking-wide text-muted">Private groups</h3> : null}
                <GroupGrid groups={privateGroups} label="Private groups" />
              </>
            ) : null}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-mist-200 bg-white px-5 py-10 text-center text-sm text-muted">
            {query ? `No groups match “${query}”. Try another word or browse all groups.` : 'No groups yet. Sea N Shore administrators create the first groups.'}
          </div>
        )}
      </section>
    </section>
  )
}
