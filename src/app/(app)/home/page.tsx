import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getFeedPage } from '@/features/feed/queries'
import { parseFeedCategory } from '@/features/feed/schemas'
import { FeedCategoryFilter } from '@/features/feed/components/feed-category-filter'
import { FeedLayout } from '@/features/feed/components/feed-layout'
import { FeedList } from '@/features/feed/components/feed-list'
import { PostComposer } from '@/features/feed/components/post-composer'
import { parseComposeRequest } from '@/features/feed/compose-request'
import { getPeopleYouMayKnow } from '@/features/network/queries'
import { getHomeRailData } from '@/features/profiles/home-rail-queries'
import { getOwnProfilePortfolio } from '@/features/profiles/profile-portfolio-queries'
import { getOwnProfile } from '@/features/profiles/queries'

export const metadata: Metadata = { title: 'Home' }

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; compose?: string }>
}) {
  const profile = await getOwnProfile()
  if (!profile) redirect('/onboarding')

  const { category: categoryValue, compose } = await searchParams
  const category = parseFeedCategory(categoryValue)
  // /home?compose=update|photo|document|question|poll (phone Create sheet) opens the composer.
  const composeRequest = parseComposeRequest(compose)
  const [initialPage, suggestions, portfolio, rail] = await Promise.all([
    getFeedPage({ category }),
    getPeopleYouMayKnow(5),
    getOwnProfilePortfolio(),
    getHomeRailData(profile.id),
  ])
  const portfolioCompletion = {
    experienceCount: portfolio.experiences.length,
    credentialCount: portfolio.credentials.length,
  }
  const feedVersion = initialPage.posts
    .map((post) => [
      post.id,
      post.updatedAt,
      post.likeCount,
      post.commentCount,
      post.viewerLiked ? 1 : 0,
      post.viewerSaved ? 1 : 0,
      post.poll?.totalVotes ?? 0,
      post.poll?.viewerOptionId ?? '',
    ].join(':'))
    .join('|')

  return (
    <FeedLayout
      profile={profile}
      portfolioCompletion={portfolioCompletion}
      suggestions={suggestions.slice(0, 3)}
      verified={rail.verified}
    >
      {/* On phones the trigger card is hidden: the Post tab's Create sheet opens the composer. */}
      <div id="feed-composer" className="scroll-mt-24">
        <PostComposer profile={profile} defaultCategory={category} composeRequest={composeRequest} hideTriggerOnPhones />
      </div>
      {/* Topic chips are a phone addition (round 8); desktop and tablet keep today's feed. */}
      <FeedCategoryFilter category={category} className="md:hidden" />
      <div className="mt-4 max-md:mt-1">
        <FeedList
          key={`${category ?? 'all'}:${feedVersion}`}
          initialPage={initialPage}
          category={category}
          suggestions={suggestions}
        />
      </div>
    </FeedLayout>
  )
}
