import type {
  FeedAuthor,
  FeedComment,
  FeedMention,
  FeedPost,
  PostCategory,
  PostReactionType,
  ReactionSummary,
} from './types'
import { EMPTY_REACTION_SUMMARY, POST_REACTIONS, reactionCount } from './types'

type MaritimeSummaryRow = {
  rank: string | null
  current_company: string | null
}

type AuthorRow = {
  id: string
  slug: string | null
  full_name: string
  avatar_path: string | null
  headline: string | null
  maritime_profiles: MaritimeSummaryRow | MaritimeSummaryRow[] | null
}

type MentionRow = {
  profile_id: string
  slug: string | null
  full_name: string
}

type ReactionCountsRow = Partial<Record<PostReactionType, number>> & { count?: number }

export type FeedCommentRow = {
  id: string
  post_id?: string
  parent_comment_id?: string | null
  body: string
  created_at: string
  profiles: AuthorRow | AuthorRow[] | null
  reaction_summary?: ReactionCountsRow | null
  viewer_reaction?: PostReactionType | null
  mentions?: MentionRow[] | null
}

type MediaRow = {
  storage_path: string
  mime_type: string
  alt_text: string | null
}

type PollOptionRow = {
  id: string
  label: string
  position: number
  post_poll_votes?: Array<{ count: number }> | { count: number } | null
}

type PollRow = {
  post_poll_options: PollOptionRow[]
}

export type FeedPostRow = {
  id: string
  category: PostCategory
  body: string
  post_type: 'standard' | 'poll'
  created_at: string
  updated_at: string
  profiles: AuthorRow | AuthorRow[] | null
  post_media: MediaRow | MediaRow[] | null
  post_polls: PollRow | PollRow[] | null
  post_reactions?: ReactionCountsRow | Array<{ count: number }> | { count: number } | null
  post_comment_count?: Array<{ count: number }> | { count: number } | null
  post_mentions?: MentionRow[] | null
  post_comments?: FeedCommentRow[] | null
}

export type FeedViewerState = {
  postReactions?: Map<string, PostReactionType>
  likedPostIds?: Set<string>
  savedPostIds: Set<string>
  pollVotes: Map<string, string>
}

function firstOrNull<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function countRelation(value: Array<{ count: number }> | { count: number } | null | undefined) {
  if (Array.isArray(value)) return value[0]?.count ?? 0
  return value?.count ?? 0
}

function mapReactionSummary(value: FeedPostRow['post_reactions'] | FeedCommentRow['reaction_summary']): ReactionSummary {
  if (!value || Array.isArray(value)) {
    const legacy = countRelation(value as Array<{ count: number }> | { count: number } | null | undefined)
    return { ...EMPTY_REACTION_SUMMARY, like: legacy }
  }
  const row = value as ReactionCountsRow
  if (!POST_REACTIONS.some((reaction) => row[reaction] !== undefined)) {
    return { ...EMPTY_REACTION_SUMMARY, like: Number(row.count ?? 0) }
  }
  return {
    like: Number(row.like ?? 0),
    support: Number(row.support ?? 0),
    respect: Number(row.respect ?? 0),
    on_point: Number(row.on_point ?? 0),
  }
}

function mapMentions(rows: MentionRow[] | null | undefined): FeedMention[] {
  return (rows ?? []).flatMap((row) => row.slug ? [{
    profileId: row.profile_id,
    slug: row.slug,
    fullName: row.full_name,
  }] : [])
}

export function feedAuthorAvatarPath(row: AuthorRow | AuthorRow[] | null | undefined) {
  return firstOrNull(row)?.avatar_path ?? null
}

function mapAuthor(row: AuthorRow | AuthorRow[] | null, signedUrls: Map<string, string>): FeedAuthor {
  const author = firstOrNull(row)
  if (!author || !author.slug) throw new Error('Feed author is missing a completed professional identity.')
  const maritime = firstOrNull(author.maritime_profiles)
  return {
    id: author.id,
    slug: author.slug,
    fullName: author.full_name,
    avatarPath: author.avatar_path,
    avatarUrl: author.avatar_path ? signedUrls.get(author.avatar_path) ?? null : null,
    headline: author.headline,
    rank: maritime?.rank ?? null,
    currentCompany: maritime?.current_company ?? null,
  }
}

function mapComment(row: FeedCommentRow, signedUrls: Map<string, string>): FeedComment {
  const reactionSummary = mapReactionSummary(row.reaction_summary)
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    author: mapAuthor(row.profiles, signedUrls),
    parentCommentId: row.parent_comment_id ?? null,
    reactionSummary,
    reactionCount: reactionCount(reactionSummary),
    viewerReaction: row.viewer_reaction ?? null,
    mentions: mapMentions(row.mentions),
  }
}

export function mapFeedPost(
  row: FeedPostRow,
  viewer: FeedViewerState,
  signedUrls: Map<string, string> = new Map(),
  viewerProfileId = '',
): FeedPost {
  const media = firstOrNull(row.post_media)
  const poll = firstOrNull(row.post_polls)
  const options = [...(poll?.post_poll_options ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((option) => ({
      id: option.id,
      label: option.label,
      position: option.position,
      voteCount: countRelation(option.post_poll_votes),
    }))
  const totalVotes = options.reduce((total, option) => total + option.voteCount, 0)
  const author = mapAuthor(row.profiles, signedUrls)
  const comments = (row.post_comments ?? []).map((comment) => mapComment(comment, signedUrls))
  const reactionSummary = mapReactionSummary(row.post_reactions)
  const viewerReaction = viewer.postReactions?.get(row.id)
    ?? (viewer.likedPostIds?.has(row.id) ? 'like' : null)

  return {
    id: row.id,
    category: row.category,
    body: row.body,
    postType: row.post_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author,
    media: media
      ? {
          storagePath: media.storage_path,
          mimeType: media.mime_type,
          altText: media.alt_text,
          signedUrl: signedUrls.get(media.storage_path) ?? null,
        }
      : null,
    poll: row.post_type === 'poll'
      ? {
          options,
          totalVotes,
          viewerOptionId: viewer.pollVotes.get(row.id) ?? null,
        }
      : null,
    reactionSummary,
    reactionCount: reactionCount(reactionSummary),
    viewerReaction,
    likeCount: reactionSummary.like,
    viewerLiked: viewerReaction === 'like',
    commentCount: countRelation(row.post_comment_count) || comments.length,
    viewerSaved: viewer.savedPostIds.has(row.id),
    viewerOwns: Boolean(viewerProfileId) && author.id === viewerProfileId,
    mentions: mapMentions(row.post_mentions),
    comments,
  }
}
