import type { ReactNode } from 'react'
import { RailFooter } from '@/components/navigation/rail-footer'
import type { NetworkProfile } from '@/features/network/types'
import type { OwnProfile } from '@/features/profiles/types'
import type { ProfilePortfolioCompletion } from '../profile-completion'
import { FeedDiscoveryRail } from './feed-discovery-rail'
import { FeedLeftRail, FeedQuickActions } from './feed-left-rail'
import { FeedProfileCard } from './feed-profile-card'

export function FeedLayout({
  profile,
  portfolioCompletion,
  suggestions,
  verified = false,
  children,
}: {
  profile: OwnProfile
  portfolioCompletion: ProfilePortfolioCompletion
  suggestions: NetworkProfile[]
  verified?: boolean
  children: ReactNode
}) {
  return (
    <section className="grid gap-5 py-2 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_300px] xl:gap-6">
      <aside className="hidden lg:block">
        {/* Scrolls on its own when the rail is taller than the window, so Quick actions is never stuck below the fold. */}
        <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-4 pr-1 [scrollbar-width:thin]">
          <FeedLeftRail profile={profile} portfolioCompletion={portfolioCompletion} verified={verified} />
        </div>
      </aside>

      <main className="min-w-0">
        <div className="mb-4 space-y-3 lg:hidden">
          <FeedProfileCard profile={profile} portfolioCompletion={portfolioCompletion} verified={verified} compact />
          <FeedQuickActions compact />
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
