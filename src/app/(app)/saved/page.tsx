import type { Metadata } from 'next'
import Link from 'next/link'
import { Bookmark } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { Card } from '@/components/ui/card'
import { getSavedPosts } from '@/features/feed/queries'
import { SavedPostsGrid } from './saved-posts-grid'

export const metadata: Metadata = { title: 'Saved posts' }

export default async function SavedPostsPage() {
  const posts = await getSavedPosts()

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <MobilePageBar backHref="/home" title="Saved posts" />
      {/* Phones: the page bar title replaces the intro. */}
      <header className="flex flex-wrap max-md:hidden items-end justify-between gap-x-4 gap-y-1">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ocean-700">Your library</p>
          <h1 className="mt-1 text-2xl font-semibold text-navy-950">Saved posts</h1>
          <p className="mt-1 text-sm text-muted">Posts you saved for later. Select one to read it in full or remove it from Saved.</p>
        </div>
        {posts.length ? <p className="text-sm font-semibold text-muted">{posts.length} {posts.length === 1 ? 'post' : 'posts'}</p> : null}
      </header>

      {posts.length > 0 ? (
        <SavedPostsGrid posts={posts} />
      ) : (
        <Card className="border border-mist-100 p-8 text-center">
          <Bookmark aria-hidden="true" className="mx-auto size-7 text-ocean-700" />
          <p className="mt-3 font-semibold text-navy-950">No saved posts yet.</p>
          <p className="mt-1 text-sm text-muted">Save useful maritime updates from Home and they’ll appear here.</p>
          <Link
            href="/home"
            className="mt-5 inline-flex min-h-10 items-center justify-center rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-900"
          >
            Browse the feed
          </Link>
        </Card>
      )}
    </div>
  )
}
