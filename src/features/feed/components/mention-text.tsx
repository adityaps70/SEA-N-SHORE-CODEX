import Link from 'next/link'
import type { FeedMention } from '../types'

type MentionTextProps = {
  body: string
  mentions: FeedMention[]
  className?: string
}

type Segment =
  | { type: 'text'; value: string }
  | { type: 'mention'; value: string; mention: FeedMention }

function segmentBody(body: string, mentions: FeedMention[]): Segment[] {
  if (!mentions.length) return [{ type: 'text', value: body }]

  const labels = mentions
    .map((mention) => ({ mention, token: `@${mention.fullName}` }))
    .sort((a, b) => b.token.length - a.token.length)

  const segments: Segment[] = []
  let cursor = 0

  while (cursor < body.length) {
    let nextIndex = -1
    let nextLabel: (typeof labels)[number] | null = null

    for (const label of labels) {
      const index = body.indexOf(label.token, cursor)
      if (index < 0) continue
      if (nextIndex === -1 || index < nextIndex || (index === nextIndex && label.token.length > (nextLabel?.token.length ?? 0))) {
        nextIndex = index
        nextLabel = label
      }
    }

    if (nextIndex < 0 || !nextLabel) {
      segments.push({ type: 'text', value: body.slice(cursor) })
      break
    }

    if (nextIndex > cursor) segments.push({ type: 'text', value: body.slice(cursor, nextIndex) })
    segments.push({ type: 'mention', value: nextLabel.token, mention: nextLabel.mention })
    cursor = nextIndex + nextLabel.token.length
  }

  return segments
}

export function MentionText({ body, mentions, className }: MentionTextProps) {
  const segments = segmentBody(body, mentions)
  return (
    <span className={className}>
      {segments.map((segment, index) => segment.type === 'mention' ? (
        <Link
          key={`${segment.mention.profileId}-${index}`}
          href={`/people/${segment.mention.slug}`}
          className="font-semibold text-ocean-700 hover:underline"
        >
          {segment.value}
        </Link>
      ) : <span key={`text-${index}`}>{segment.value}</span>)}
    </span>
  )
}
