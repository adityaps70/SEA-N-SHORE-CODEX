'use client'

import {
  POST_REACTIONS,
  POST_REACTION_META,
  reactionCount,
  type ReactionSummary,
} from '../types'

/**
 * The reaction types present on a post or comment, as overlapping emoji (no number: the total
 * sits in the Like button). Sits at the far right of the action row and opens the list of
 * people who reacted. Renders nothing when there are no reactions.
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
  const bubble = variant === 'comment' ? 'size-5 text-[11px]' : 'size-6 text-sm'

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`View ${total} ${noun}`}
      title={`See who reacted (${total})`}
      data-testid="reaction-summary"
      className={`inline-flex shrink-0 cursor-pointer items-center rounded-full border border-mist-200 bg-white transition hover:border-ocean-300 hover:bg-mist-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40 ${variant === 'comment' ? 'min-h-7 px-1' : 'min-h-9 px-1.5'} ${className}`.trim()}
    >
      <span aria-hidden="true" data-testid="reaction-summary-types" className="inline-flex items-center -space-x-1.5">
        {active.map((reaction, index) => (
          <span
            key={reaction}
            style={{ zIndex: active.length - index }}
            className={`relative grid place-items-center rounded-full bg-white leading-none ring-2 ring-white ${bubble}`}
          >
            {POST_REACTION_META[reaction].emoji}
          </span>
        ))}
      </span>
    </button>
  )
}
