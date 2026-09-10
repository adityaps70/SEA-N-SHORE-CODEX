'use client'

import { ThumbsUp } from 'lucide-react'
import {
  POST_REACTIONS,
  POST_REACTION_META,
  reactionCount,
  type ReactionSummary,
} from '../types'

export function ReactionSummaryTrigger({
  summary,
  commentCount,
  onOpen,
}: {
  summary: ReactionSummary
  commentCount: number
  onOpen(): void
}) {
  const total = reactionCount(summary)
  const active = POST_REACTIONS.filter((reaction) => summary[reaction] > 0)
  const label = total ? `${total} ${total === 1 ? 'reaction' : 'reactions'}` : 'Be the first to react'

  return (
    <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`View ${total} ${total === 1 ? 'reaction' : 'reactions'}`}
        className="min-w-0 truncate rounded-lg text-left transition hover:text-ocean-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/30"
      >
        {label}
      </button>

      <div className="flex shrink-0 items-center gap-3">
        <span>{commentCount} {commentCount === 1 ? 'comment' : 'comments'}</span>
        <button
          type="button"
          onClick={onOpen}
          aria-label={`View ${total} ${total === 1 ? 'reaction' : 'reactions'}`}
          className="inline-flex min-h-7 items-center rounded-full px-1 transition hover:bg-mist-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/30"
        >
          {active.length ? (
            <span aria-hidden="true" className="inline-flex -space-x-0.5 text-sm leading-none">
              {active.map((reaction) => (
                <span key={reaction}>{POST_REACTION_META[reaction].emoji}</span>
              ))}
            </span>
          ) : (
            <ThumbsUp aria-hidden="true" className="size-4" />
          )}
        </button>
      </div>
    </div>
  )
}
