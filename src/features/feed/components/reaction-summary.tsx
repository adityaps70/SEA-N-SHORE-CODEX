'use client'

import {
  POST_REACTIONS,
  POST_REACTION_META,
  reactionCount,
  type ReactionSummary,
} from '../types'

export function ReactionSummaryTrigger({
  summary,
  onOpen,
}: {
  summary: ReactionSummary
  onOpen(): void
}) {
  const total = reactionCount(summary)
  const active = POST_REACTIONS.filter((reaction) => summary[reaction] > 0)

  if (!total) return null

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`View ${total} ${total === 1 ? 'reaction' : 'reactions'}`}
      className="inline-flex min-h-9 items-center gap-1 rounded-xl px-1.5 text-xs text-muted transition hover:bg-mist-50 hover:text-navy-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/30"
    >
      <span aria-hidden="true" className="inline-flex -space-x-0.5 text-sm leading-none">
        {active.map((reaction) => (
          <span key={reaction}>{POST_REACTION_META[reaction].emoji}</span>
        ))}
      </span>
      <span>{total}</span>
    </button>
  )
}
