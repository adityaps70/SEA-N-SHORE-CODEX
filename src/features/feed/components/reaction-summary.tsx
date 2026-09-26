'use client'

import {
  POST_REACTIONS,
  POST_REACTION_META,
  reactionCount,
  type ReactionSummary,
} from '../types'

/**
 * Compact reaction total that opens the reactor list. The number always sits on the
 * left of the reaction-type symbols, e.g. "12 👍❤️", for posts and comments alike.
 */
export function ReactionSummaryTrigger({
  summary,
  onOpen,
  variant = 'post',
  className = '',
}: {
  summary: ReactionSummary
  onOpen(): void
  variant?: 'post' | 'comment'
  className?: string
}) {
  const total = reactionCount(summary)
  const active = POST_REACTIONS.filter((reaction) => summary[reaction] > 0)

  if (!total) return null

  const noun = variant === 'comment'
    ? `comment ${total === 1 ? 'reaction' : 'reactions'}`
    : total === 1 ? 'reaction' : 'reactions'

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`View ${total} ${noun}`}
      data-testid="reaction-summary"
      className={`inline-flex items-center gap-1 rounded-xl text-muted transition hover:bg-mist-50 hover:text-navy-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/30 ${variant === 'comment' ? 'min-h-8 px-1 text-[11px]' : 'min-h-9 px-1.5 text-xs'} ${className}`.trim()}
    >
      <span data-testid="reaction-summary-count" className="font-semibold tabular-nums">{total}</span>
      <span aria-hidden="true" className={`inline-flex items-center -space-x-0.5 leading-none ${variant === 'comment' ? 'text-xs' : 'text-sm'}`}>
        {active.map((reaction) => (
          <span key={reaction}>{POST_REACTION_META[reaction].emoji}</span>
        ))}
      </span>
    </button>
  )
}
