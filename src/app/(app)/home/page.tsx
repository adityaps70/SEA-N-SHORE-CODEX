import { redirect } from 'next/navigation'
import { getOwnProfile } from '@/features/profiles/queries'
import { getFeedPage } from '@/features/feed/queries'
import { parseFeedCategory } from '@/features/feed/schemas'
import { FeedLayout } from '@/features/feed/components/feed-layout'
import { PostComposer } from '@/features/feed/components/post-composer'
import { FeedCategoryFilter } from '@/features/feed/components/feed-category-filter'
import { FeedList } from '@/features/feed/components/feed-list'

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>
}) {
  const profile = await getOwnProfile()
  if (!profile) redirect('/onboarding')

  const { category: categoryValue } = await searchParams
  const category = parseFeedCategory(categoryValue)
  const initialPage = await getFeedPage({ category })

  return (
    <FeedLayout profile={profile} category={category}>
      <div id="feed-composer" className="scroll-mt-24">
        <PostComposer profile={profile} defaultCategory={category} />
      </div>
      <div className="mt-4">
        <FeedCategoryFilter category={category} />
      </div>
      <div className="mt-4">
        <FeedList initialPage={initialPage} category={category} />
      </div>
    </FeedLayout>
  )
}
