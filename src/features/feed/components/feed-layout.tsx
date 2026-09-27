import type { ReactNode } from 'react'
import { RailFooter } from '@/components/navigation/rail-footer'
import type { NetworkProfile } from '@/features/network/types'
import type { HomeOrganizationShortcuts } from '@/features/profiles/home-rail-queries'
import type { OwnProfile } from '@/features/profiles/types'
import type { ProfilePortfolioCompletion } from '../profile-completion'
import { FeedDiscoveryRail } from './feed-discovery-rail'
import { FeedLeftRail } from './feed-left-rail'
import { FeedProfileCard } from './feed-profile-card'

export function FeedLayout({
  profile,
  portfolioCompletion,
  suggestions,
  verified = false,
  organizations,
  children,
}: {
  profile: OwnProfile
  portfolioCompletion: ProfilePortfolioCompletion
  suggestions: NetworkProfile[]
  verified?: boolean
  organizations?: HomeOrganizationShortcuts | null
  children: ReactNode
}) {
  return (
    <section className="grid gap-5 py-2 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_300px] xl:gap-6">
      <aside className="hidden lg:block">
        <div className="sticky top-24 pb-4 pr-1">
          <FeedLeftRail profile={profile} portfolioCompletion={portfolioCompletion} verified={verified} organizations={organizations} />
        </div>
      </aside>

      <main className="min-w-0">
        <div className="mb-4 lg:hidden">
          <FeedProfileCard profile={profile} portfolioCompletion={portfolioCompletion} verified={verified} compact />
        </div>
        {children}
      </main>

      <aside className="hidden xl:block">
        <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-4 pr-1">
          <FeedDiscoveryRail suggestions={suggestions} />
          <RailFooter visibleFrom="xl" />
        </div>
      </aside>
    </section>
  )
}
