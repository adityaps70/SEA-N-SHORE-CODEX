import { MessageSquareText } from 'lucide-react'
import type { CommentActivity } from '../queries'
import { PostCard } from './post-card'

/**
 * UTC, as the server (UTC) has always rendered it: the card now also renders inside the client
 * "Load more" list (Round 14, 3.7), and a browser time zone would make hydration disagree.
 */
function formatCommentTime(value: string) {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value))
}

export function CommentActivityCard({ activity }: { activity: CommentActivity }) {
  return (
    <section className="space-y-3">
      <div className="rounded-[1.35rem] border border-ocean-100 bg-ocean-50/60 p-4 sm:p-5">
        <div className="flex items-center gap-2 text-ocean-700">
          <MessageSquareText aria-hidden="true" className="size-4" />
          <p className="text-xs font-semibold uppercase tracking-[.12em]">Your comment{activity.viewerComments.length === 1 ? '' : 's'}</p>
        </div>
        <div className="mt-3 space-y-3">
          {activity.viewerComments.map((comment) => (
            <div key={comment.id} className="rounded-xl bg-white px-4 py-3 shadow-sm">
              <p className="text-sm leading-6 text-ink">{comment.body}</p>
              <p className="mt-1.5 text-xs font-medium text-muted">{formatCommentTime(comment.createdAt)}</p>
            </div>
          ))}
        </div>
      </div>
      <PostCard post={activity.post} />
    </section>
  )
}
