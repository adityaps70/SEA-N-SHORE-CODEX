'use client'

import { use } from 'react'
import type { NetworkProfile } from '@/features/network/types'
import type { HomeFeed as HomeFeedData } from '../queries'
import type { PostCategory } from '../types'
import { FeedDiscoveryRail } from './feed-discovery-rail'
import { FeedList } from './feed-list'
import { HomeFeed } from './home-feed'

/**
 * Round P3: Home's slow parts stream in. The page sends its shell (rails, profile card, composer)
 * as soon as the cheap queries return, and these sections fill in when the feed and the people
 * suggestions arrive, each behind its own <Suspense> on the page.
 */
export function StreamedDiscoveryRail({ suggestions }: { suggestions: Promise<NetworkProfile[]> }) {
  return <FeedDiscoveryRail suggestions={use(suggestions)} />
}

export function StreamedHomeFeed({
  feed,
  suggestions,
  category,
  debug,
}: {
  feed: Promise<HomeFeedData>
  suggestions: Promise<NetworkProfile[]>
  category?: PostCategory
  debug: boolean
}) {
  const homeFeed = use(feed)
  const people = use(suggestions)
  // Keyed by category only: a reaction or comment refreshes the first page, which FeedList and
  // PostCard reconcile in place, so the loaded pages and scroll position survive (round 10).
  if (homeFeed.mode === 'v1') {
    return <FeedList key={category ?? 'all'} initialPage={homeFeed.page} category={category} suggestions={people} />
  }
  // Round G: Top for you · Recent. ?rankdebug=1 shows score parts to administrators only (checked on the server).
  return (
    <HomeFeed
      key={category ?? 'all'}
      initialMode={homeFeed.mode}
      initialRecentPage={homeFeed.page}
      suggestions={people}
      debug={debug}
      {...(category ? { category } : {})}
    />
  )
}
