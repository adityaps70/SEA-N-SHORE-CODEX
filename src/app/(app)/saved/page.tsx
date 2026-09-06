import Link from 'next/link'
import { Bookmark } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { PostCard } from '@/features/feed/components/post-card'
import { getSavedPosts } from '@/features/feed/queries'

export default async function SavedPostsPage() {
  const posts = await getSavedPosts()

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ocean-700">Your library</p>
        <h1 className="mt-1 text-2xl font-semibold text-navy-950">Saved posts</h1>
        <p className="mt-2 text-sm text-muted">Posts you saved for later.</p>
      </header>

      {posts.length > 0 ? (
        <div className="space-y-4">
          {posts.map((post) => <PostCard key={post.id} post={post} />)}
        </div>
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
