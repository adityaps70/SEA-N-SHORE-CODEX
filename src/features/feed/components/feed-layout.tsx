import type { ReactNode } from 'react'
import { RailFooter } from '@/components/navigation/rail-footer'
import type { NetworkProfile } from '@/features/network/types'
import type { OwnProfile } from '@/features/profiles/types'
import { calculateProfileCompletion, nextProfileCompletionHint, type ProfilePortfolioCompletion } from '../profile-completion'
import { FeedDiscoveryRail } from './feed-discovery-rail'
import { FeedLeftRail, FeedQuickActions } from './feed-left-rail'
import { FeedProfileCard } from './feed-profile-card'
import { ProfileCompletionBanner } from './profile-completion-banner'

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
  const completion = calculateProfileCompletion(profile, portfolioCompletion)
  return (
    <section className="grid gap-5 py-2 max-md:gap-0 max-md:py-0 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_300px] xl:gap-6">
      <aside className="hidden lg:block">
        {/* Scrolls on its own when the rail is taller than the window, so Quick actions is never stuck below the fold. */}
        <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-4 pr-1 [scrollbar-width:thin]">
          <FeedLeftRail profile={profile} portfolioCompletion={portfolioCompletion} verified={verified} />
        </div>
      </aside>

      <main className="min-w-0">
        {/* Phones: one slim reminder instead of the profile card and shortcuts, which live in the
            side drawer (profile, Saved posts) and the bottom tabs (Jobs, Network). */}
        <ProfileCompletionBanner completion={completion} hint={nextProfileCompletionHint(profile, portfolioCompletion)} />
        <div data-testid="feed-compact-rail" className="mb-4 space-y-3 max-md:hidden lg:hidden">
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
