import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Hash } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { FeedList } from '@/features/feed/components/feed-list'
import { getFeedPage } from '@/features/feed/queries'
import { HashtagFollowButton } from '@/features/hashtags/components/hashtag-follow-button'
import { hashtagFromParam } from '@/features/hashtags/page-param'
import { hashtagRepository } from '@/features/hashtags/repository'

export async function generateMetadata({ params }: { params: Promise<{ tag: string }> }): Promise<Metadata> {
  const { tag: raw } = await params
  const tag = hashtagFromParam(raw)
  return { title: tag ? `#${tag}` : 'Hashtag' }
}

/**
 * Hashtag page (round 9B): every public post carrying the tag, newest first, with a Follow
 * button. Group posts stay inside their group; block and visibility rules apply as on the feed.
 */
export default async function HashtagPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag: raw } = await params
  const tag = hashtagFromParam(raw)
  if (!tag) notFound()

  const user = await requireAwsUser()
  const [summary, following, initialPage] = await Promise.all([
    hashtagRepository.getHashtagSummary(tag),
    hashtagRepository.isFollowingHashtag(user.id, tag),
    getFeedPage({ hashtag: tag }),
  ])
  const postCount = Math.max(summary?.postCount ?? 0, initialPage.posts.length)
  const followerCount = summary?.followerCount ?? 0

  return (
    <>
      <MobilePageBar backHref="/home" title={`#${tag}`} />
      <section className="mx-auto w-full max-w-3xl py-2 sm:py-5 max-md:-mx-4 max-md:w-auto max-md:py-0">
        <header className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:p-4 max-md:shadow-none">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
                <Hash aria-hidden="true" className="size-6" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-bold text-navy-950 max-md:text-xl">#{tag}</h1>
                <p data-testid="hashtag-post-count" className="mt-0.5 text-sm text-muted">
                  {postCount.toLocaleString('en-IN')} {postCount === 1 ? 'post' : 'posts'}
                </p>
              </div>
            </div>
            <HashtagFollowButton tag={tag} initialFollowing={following} initialFollowerCount={followerCount} className="max-md:w-full" />
          </div>
        </header>

        <div className="mt-4 max-md:mt-2">
          {initialPage.posts.length ? (
            <FeedList initialPage={initialPage} scope={{ hashtag: tag }} />
          ) : (
            <div className="rounded-2xl border border-dashed border-mist-200 bg-white px-5 py-10 text-center max-md:rounded-none max-md:border-x-0">
              <p className="font-semibold text-navy-950">No posts with #{tag} yet.</p>
              <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted">
                Follow the hashtag to keep an eye on it, or add #{tag} to your next post to start the conversation.
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
