import Link from '@/components/navigation/intent-link'
import { Fragment, type ReactNode } from 'react'
import { findHashtags, hashtagHref, isStorableHashtag } from '@/features/hashtags/parse'
import { parseMarkdown, truncateMarkdown, type MarkdownInline, type MarkdownSource } from '../markdown'
import type { FeedMention, FeedOrganizationMention } from '../types'

type MentionTextProps = {
  body: string
  mentions?: FeedMention[]
  /** Organization pages tagged with "@" (round 9B); they link to /organizations/<slug>. */
  organizationMentions?: FeedOrganizationMention[]
  className?: string
  /** Round H (H2): show only the part of the body before this offset (collapsed "…more" text). */
  truncateAt?: number
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

const MENTION_LINK_CLASS = 'font-semibold text-ocean-700 hover:underline'
const MARKDOWN_LINK_CLASS = 'font-medium text-ocean-700 underline decoration-ocean-300 underline-offset-2 hover:decoration-ocean-700'

type AtomSegment = Exclude<BodySegment, { type: 'text' }>

function SegmentLink({ segment }: { segment: AtomSegment }) {
  if (segment.type === 'mention') {
    return (
      <Link href={`/people/${segment.mention.slug}`} className={MENTION_LINK_CLASS}>
        {segment.value}
      </Link>
    )
  }
  if (segment.type === 'organization') {
    return (
      <Link href={`/organizations/${segment.organization.slug}`} className={MENTION_LINK_CLASS}>
        {segment.value}
      </Link>
    )
  }
  return (
    <Link href={hashtagHref(segment.tag)} className="font-medium text-ocean-700 hover:underline">
      {segment.value}
    </Link>
  )
}

type Inline = MarkdownInline<AtomSegment>

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.type === 'text') return <span key={`text-${index}`}>{node.value}</span>
    if (node.type === 'atom') return <SegmentLink key={`atom-${index}`} segment={node.atom} />
    if (node.type === 'strong') return <strong key={`strong-${index}`} className="font-bold">{renderInline(node.children)}</strong>
    if (node.type === 'emphasis') return <em key={`em-${index}`} className="italic">{renderInline(node.children)}</em>
    if (!node.external) {
      return <Link key={`link-${index}`} href={node.href} className={MARKDOWN_LINK_CLASS}>{node.label}</Link>
    }
    return (
      <a key={`link-${index}`} href={node.href} target="_blank" rel="nofollow ugc noopener noreferrer" className={MARKDOWN_LINK_CLASS}>
        {node.label}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    )
  })
}

/**
 * Round H (H2): the body tree (text, atoms and Markdown) for a post or comment. Mentions and
 * hashtags become atoms first, so Markdown is only read from the plain text around them.
 */
function bodyMarkdown(body: string, mentions: FeedMention[] = [], organizationMentions: FeedOrganizationMention[] = []) {
  return parseMarkdown(segmentBody(body, mentions, organizationMentions).map((segment): MarkdownSource<AtomSegment> => (
    segment.type === 'text' ? { kind: 'text', value: segment.value } : { kind: 'atom', value: segment.value, atom: segment }
  )))
}

export function MentionText({ body, mentions = [], organizationMentions = [], className, truncateAt }: MentionTextProps) {
  const blocks = bodyMarkdown(body, mentions, organizationMentions)
  const visible = truncateAt === undefined ? blocks : truncateMarkdown(blocks, truncateAt)
  return (
    <span className={className}>
      {visible.map((block, blockIndex) => {
        if (block.type === 'text') return <Fragment key={`block-${blockIndex}`}>{renderInline(block.children)}</Fragment>
        // Round H (H2): lists are spans with list roles because the body sits inside a <p>.
        return (
          <span key={`block-${blockIndex}`} role="list" data-list={block.ordered ? 'ordered' : 'bulleted'} className="my-1 block">
            {block.items.map((item, itemIndex) => (
              <span key={`item-${itemIndex}`} role="listitem" className="flex gap-2 pl-1">
                <span aria-hidden={block.ordered ? undefined : true} className={`shrink-0 ${block.ordered ? 'min-w-5 text-right tabular-nums' : 'text-ocean-700'}`}>{item.marker}</span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap">{renderInline(item.children)}</span>
              </span>
            ))}
          </span>
        )
      })}
    </span>
  )
}
