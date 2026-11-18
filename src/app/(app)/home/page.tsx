import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { getHomeFeed } from '@/features/feed/queries'
import { parseFeedCategory } from '@/features/feed/schemas'
import { FeedLayout } from '@/features/feed/components/feed-layout'
import { FeedSkeleton } from '@/features/feed/components/home-feed'
import { StreamedDiscoveryRail, StreamedHomeFeed } from '@/features/feed/components/home-streamed-sections'
import { PostComposer } from '@/features/feed/components/post-composer'
import { parseComposeRequest } from '@/features/feed/compose-request'
import { getPeopleYouMayKnow } from '@/features/network/queries'
import { PEOPLE_SUGGESTION_LIMITS } from '@/features/network/recommendations'
import type { NetworkProfile } from '@/features/network/types'
import { getHomeRailData } from '@/features/profiles/home-rail-queries'
import { getOwnProfilePortfolio } from '@/features/profiles/profile-portfolio-queries'
import { getOwnProfile } from '@/features/profiles/queries'
import { RankSelectionPrompt } from '@/features/roles/components/rank-selection-prompt'
import { HomeCountryPrompt } from '@/features/countries/components/profile-country-sections'

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
  // Round P3: the feed and the people suggestions start now and stream in behind <Suspense>, so the
  // shell no longer waits for the slowest query. One suggestion list feeds the desktop rail (3 shown)
  // and the phone feed row (up to 10); the rest are spares. Without suggestions the page still works.
  const suggestions = getPeopleYouMayKnow(PEOPLE_SUGGESTION_LIMITS.feedRow).catch((): NetworkProfile[] => [])
  const homeFeed = getHomeFeed({ category })
  // The feed section awaits (and reports) a failure; this only keeps it from going unobserved while the shell renders.
  homeFeed.catch(() => undefined)
  const [portfolio, rail] = await Promise.all([
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
      discoveryRail={(
        <Suspense fallback={null}>
          <StreamedDiscoveryRail suggestions={suggestions} />
        </Suspense>
      )}
      verified={rail.verified}
    >
      <RankSelectionPrompt profile={profile} className="mb-4 max-md:mb-2" />
      {/* Round GP: one dismissible "which country do you live in?" prompt; streams in, never blocks the feed. */}
      <Suspense fallback={null}>
        <HomeCountryPrompt profileId={profile.id} className="mb-4 max-md:mb-2" />
      </Suspense>
      {/* On phones the trigger card is hidden: the Post tab's Create sheet opens the composer. */}
      <div id="feed-composer" className="scroll-mt-24">
        <PostComposer profile={profile} defaultCategory={category} composeRequest={composeRequest} hideTriggerOnPhones />
      </div>
      <div className="mt-4 max-md:mt-1">
        <Suspense fallback={<FeedSkeleton />}>
          <StreamedHomeFeed feed={homeFeed} suggestions={suggestions} category={category} debug={rankdebug === '1'} />
        </Suspense>
      </div>
    </FeedLayout>
  )
}
