import { MessagesSquare } from 'lucide-react'
import type { FeedPost } from '../types'
import { PostCard } from './post-card'

export function ProfilePostsSection({ posts, ownerName }: { posts: FeedPost[]; ownerName: string }) {
  return (
    <section className="rounded-[1.75rem] border border-mist-100 bg-mist-50/40 p-4 shadow-[var(--shadow-card)] sm:p-5">
      <div className="mb-4 flex items-start gap-3 px-1">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
          <MessagesSquare aria-hidden="true" className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-navy-950">Posts &amp; activity</h2>
          <p className="mt-1 text-sm leading-5 text-muted">Updates shared with signed-in Sea N Shore members.</p>
        </div>
      </div>

      {posts.length ? (
        <div className="space-y-4">
          {posts.map((post) => <PostCard key={post.id} post={post} />)}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-mist-100 bg-white px-5 py-8 text-center">
          <p className="text-sm font-medium text-muted">{ownerName} has not shared any posts yet.</p>
        </div>
      )}
    </section>
  )
}
