'use client'

import { useId, useState } from 'react'
import type { FeedMention, FeedOrganizationMention } from '../types'
import { MentionText, segmentBody } from './mention-text'

/** Post bodies collapse after about five lines or 300 characters, whichever comes first. */
export const POST_COLLAPSE = { maxLines: 5, maxChars: 300 } as const
/** Comments collapse after about three lines. */
export const COMMENT_COLLAPSE = { maxLines: 3, maxChars: 200 } as const

/**
 * Where a long body should be cut when collapsed, or null when it is short enough to show in full.
 * The cut lands on a word boundary and never splits an @mention or a #hashtag, so their links
 * keep working.
 */
export function collapsedLength(
  body: string,
  mentions: FeedMention[] = [],
  limits: { maxLines: number; maxChars: number } = POST_COLLAPSE,
  organizationMentions: FeedOrganizationMention[] = [],
): number | null {
  const lines = body.split('\n')
  let cut = body.length
  if (lines.length > limits.maxLines) {
    cut = lines.slice(0, limits.maxLines).join('\n').length
  }
  cut = Math.min(cut, limits.maxChars)
  if (cut >= body.length) return null

  // Prefer ending on a word boundary when one is reasonably close.
  if (!/\s/.test(body[cut] ?? '')) {
    const boundary = body.slice(0, cut).search(/\s\S*$/)
    if (boundary > cut * 0.6) cut = boundary
  }

  // Never cut an @mention or #hashtag in half: move the cut to just before (or after) it.
  let offset = 0
  for (const segment of segmentBody(body, mentions, organizationMentions)) {
    const start = offset
    const end = offset + segment.value.length
    offset = end
    if (segment.type === 'text' || cut <= start || cut >= end) continue
    cut = start > 0 ? start : end
    break
  }

  const visible = body.slice(0, cut).trimEnd()
  if (!visible.length || visible.length >= body.trimEnd().length) return null
  return visible.length
}

type ExpandableTextProps = {
  body: string
  mentions?: FeedMention[]
  /** Organization pages tagged with "@" (round 9B). */
  organizationMentions?: FeedOrganizationMention[]
  /** Classes for the text paragraph. */
  className?: string
  limits?: { maxLines: number; maxChars: number }
  /** Show the whole text straight away (for example on the single-post page). */
  defaultExpanded?: boolean
}

/**
 * Long text shows its first lines with an inline "…more" button (LinkedIn style) that expands in
 * place; "Show less" collapses it again. Mentions keep rendering as profile links either way.
 */
export function ExpandableText({ body, mentions = [], organizationMentions = [], className, limits = POST_COLLAPSE, defaultExpanded = false }: ExpandableTextProps) {
  const id = useId()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const cut = collapsedLength(body, mentions, limits, organizationMentions)

  if (cut === null) {
    return <p className={className}><MentionText body={body} mentions={mentions} organizationMentions={organizationMentions} /></p>
  }

  const buttonClass = 'cursor-pointer rounded font-semibold text-muted hover:text-ocean-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40'

  return (
    <p id={id} className={className} data-collapsed={expanded ? 'false' : 'true'}>
      <MentionText body={expanded ? body : body.slice(0, cut)} mentions={mentions} organizationMentions={organizationMentions} />
      {expanded ? (
        <>
          {' '}
          <button type="button" aria-expanded="true" aria-controls={id} onClick={() => setExpanded(false)} className={buttonClass}>
            Show less
          </button>
        </>
      ) : (
        <>
          <span aria-hidden="true">…</span>
          <button type="button" aria-expanded="false" aria-controls={id} onClick={() => setExpanded(true)} className={buttonClass}>
            more
          </button>
        </>
      )}
    </p>
  )
}
