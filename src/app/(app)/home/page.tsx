import { redirect } from 'next/navigation'
import { getFeedPage } from '@/features/feed/queries'
import { parseFeedCategory } from '@/features/feed/schemas'
import { FeedCategoryFilter } from '@/features/feed/components/feed-category-filter'
import { FeedLayout } from '@/features/feed/components/feed-layout'
import { FeedList } from '@/features/feed/components/feed-list'
import { PostComposer } from '@/features/feed/components/post-composer'
import { getPeopleYouMayKnow } from '@/features/network/queries'
import { getOwnProfile } from '@/features/profiles/queries'

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>
}) {
  const profile = await getOwnProfile()
  if (!profile) redirect('/onboarding')

  const { category: categoryValue } = await searchParams
  const category = parseFeedCategory(categoryValue)
  const [initialPage, suggestions] = await Promise.all([
    getFeedPage({ category }),
    getPeopleYouMayKnow(4),
  ])
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
    <FeedLayout profile={profile} category={category} suggestions={suggestions}>
      <div id="feed-composer" className="scroll-mt-24">
        <PostComposer profile={profile} defaultCategory={category} />
      </div>
      <div className="mt-4">
        <FeedCategoryFilter category={category} />
      </div>
      <div className="mt-4">
        <FeedList key={`${category ?? 'all'}:${feedVersion}`} initialPage={initialPage} category={category} />
      </div>
    </FeedLayout>
  )
}
