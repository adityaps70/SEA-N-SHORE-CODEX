import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getHomeFeed } from '@/features/feed/queries'
import { parseFeedCategory } from '@/features/feed/schemas'
import { FeedLayout } from '@/features/feed/components/feed-layout'
import { FeedList } from '@/features/feed/components/feed-list'
import { HomeFeed } from '@/features/feed/components/home-feed'
import { PostComposer } from '@/features/feed/components/post-composer'
import { parseComposeRequest } from '@/features/feed/compose-request'
import { getPeopleYouMayKnow } from '@/features/network/queries'
import { PEOPLE_SUGGESTION_LIMITS } from '@/features/network/recommendations'
import { getHomeRailData } from '@/features/profiles/home-rail-queries'
import { getOwnProfilePortfolio } from '@/features/profiles/profile-portfolio-queries'
import { getOwnProfile } from '@/features/profiles/queries'
import { RankSelectionPrompt } from '@/features/roles/components/rank-selection-prompt'

export const metadata: Metadata = { title: 'Home' }

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; compose?: string; rankdebug?: string }>
}) {
  const profile = await getOwnProfile()
  if (!profile) redirect('/onboarding')

  const { category: categoryValue, compose, rankdebug } = await searchParams
  const category = parseFeedCategory(categoryValue)
  // /home?compose=update|photo|document|question|poll (phone Create sheet) opens the composer.
  const composeRequest = parseComposeRequest(compose)
  const [homeFeed, suggestions, portfolio, rail] = await Promise.all([
    getHomeFeed({ category }),
    // One list feeds the desktop rail (3 shown) and the phone feed row (up to 10); the rest are spares.
    getPeopleYouMayKnow(PEOPLE_SUGGESTION_LIMITS.feedRow),
    getOwnProfilePortfolio(),
    getHomeRailData(profile.id),
  ])
  const portfolioCompletion = {
    experienceCount: portfolio.experiences.length,
    credentialCount: portfolio.credentials.length,
  }
  return (
    <FeedLayout
      profile={profile}
      portfolioCompletion={portfolioCompletion}
      suggestions={suggestions}
      verified={rail.verified}
    >
      <RankSelectionPrompt profile={profile} className="mb-4 max-md:mb-2" />
      {/* On phones the trigger card is hidden: the Post tab's Create sheet opens the composer. */}
      <div id="feed-composer" className="scroll-mt-24">
        <PostComposer profile={profile} defaultCategory={category} composeRequest={composeRequest} hideTriggerOnPhones />
      </div>
      <div className="mt-4 max-md:mt-1">
        {/* Keyed by category only: a reaction or comment refreshes the first page, which FeedList and
            PostCard reconcile in place, so the loaded pages and scroll position survive (round 10). */}
        {homeFeed.mode === 'v1' ? (
          <FeedList
            key={category ?? 'all'}
            initialPage={homeFeed.page}
            category={category}
            suggestions={suggestions}
          />
        ) : (
          // Round G: Top for you · Recent. ?rankdebug=1 shows score parts to administrators only (checked on the server).
          <HomeFeed
            key={category ?? 'all'}
            initialMode={homeFeed.mode}
            initialRecentPage={homeFeed.page}
            suggestions={suggestions}
            debug={rankdebug === '1'}
            {...(category ? { category } : {})}
          />
        )}
      </div>
    </FeedLayout>
  )
}
