import Link from 'next/link'
import { findHashtags, hashtagHref, isStorableHashtag } from '@/features/hashtags/parse'
import type { FeedMention, FeedOrganizationMention } from '../types'

type MentionTextProps = {
  body: string
  mentions?: FeedMention[]
  /** Organization pages tagged with "@" (round 9B); they link to /organizations/<slug>. */
  organizationMentions?: FeedOrganizationMention[]
  className?: string
}

export type BodySegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; value: string; mention: FeedMention }
  | { type: 'organization'; value: string; organization: FeedOrganizationMention }
  | { type: 'hashtag'; value: string; tag: string }

type MentionLabel = { token: string; segment: (value: string) => BodySegment }

function segmentMentions(body: string, labels: MentionLabel[]): BodySegment[] {
  if (!labels.length) return [{ type: 'text', value: body }]

  const segments: BodySegment[] = []
  let cursor = 0

  while (cursor < body.length) {
    let nextIndex = -1
    let nextLabel: MentionLabel | null = null

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
    segments.push(nextLabel.segment(nextLabel.token))
    cursor = nextIndex + nextLabel.token.length
  }

  return segments
}

/**
 * Splits a post or comment body into plain text, @member mentions, @organization mentions and
 * #hashtags. Mentions are matched first (longest label first), so a "#" inside a mention label
 * stays part of the mention; hashtags are only linked when they sit in plain text and the
 * database can store them (ASCII letters, digits, underscore).
 */
export function segmentBody(body: string, mentions: FeedMention[] = [], organizationMentions: FeedOrganizationMention[] = []): BodySegment[] {
  const labels: MentionLabel[] = [
    ...mentions.map((mention) => ({ token: `@${mention.fullName}`, segment: (value: string): BodySegment => ({ type: 'mention', value, mention }) })),
    ...organizationMentions.map((organization) => ({ token: `@${organization.name}`, segment: (value: string): BodySegment => ({ type: 'organization', value, organization }) })),
  ].sort((a, b) => b.token.length - a.token.length)

  const withMentions = segmentMentions(body, labels)
  const hashtags = findHashtags(body).filter((match) => isStorableHashtag(match.tag))
  if (!hashtags.length) return withMentions

  const segments: BodySegment[] = []
  let offset = 0
  for (const segment of withMentions) {
    const start = offset
    const end = offset + segment.value.length
    offset = end
    if (segment.type !== 'text') {
      segments.push(segment)
      continue
    }
    let cursor = start
    for (const match of hashtags) {
      if (match.start < cursor || match.end > end) continue
      if (match.start > cursor) segments.push({ type: 'text', value: body.slice(cursor, match.start) })
      segments.push({ type: 'hashtag', value: body.slice(match.start, match.end), tag: match.tag })
      cursor = match.end
    }
    if (cursor < end) segments.push({ type: 'text', value: body.slice(cursor, end) })
  }
  return segments
}

export function MentionText({ body, mentions = [], organizationMentions = [], className }: MentionTextProps) {
  const segments = segmentBody(body, mentions, organizationMentions)
  return (
    <span className={className}>
      {segments.map((segment, index) => {
        if (segment.type === 'mention') {
          return (
            <Link
              key={`${segment.mention.profileId}-${index}`}
              href={`/people/${segment.mention.slug}`}
              className="font-semibold text-ocean-700 hover:underline"
            >
              {segment.value}
            </Link>
          )
        }
        if (segment.type === 'organization') {
          return (
            <Link
              key={`org-${segment.organization.companyId}-${index}`}
              href={`/organizations/${segment.organization.slug}`}
              className="font-semibold text-ocean-700 hover:underline"
            >
              {segment.value}
            </Link>
          )
        }
        if (segment.type === 'hashtag') {
          return (
            <Link
              key={`hashtag-${segment.tag}-${index}`}
              href={hashtagHref(segment.tag)}
              className="font-medium text-ocean-700 hover:underline"
            >
              {segment.value}
            </Link>
          )
        }
        return <span key={`text-${index}`}>{segment.value}</span>
      })}
    </span>
  )
}
