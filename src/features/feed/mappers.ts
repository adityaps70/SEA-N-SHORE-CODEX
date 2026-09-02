import type { FeedAuthor, FeedComment, FeedPost, PostCategory } from './types'

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

type CommentRow = {
  id: string
  body: string
  created_at: string
  profiles: AuthorRow | AuthorRow[] | null
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
  post_reactions?: Array<{ count: number }> | { count: number } | null
  post_comments?: CommentRow[] | null
}

export type FeedViewerState = {
  likedPostIds: Set<string>
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

function mapAuthor(row: AuthorRow | AuthorRow[] | null): FeedAuthor {
  const author = firstOrNull(row)
  if (!author || !author.slug) throw new Error('Feed author is missing a completed professional identity.')
  const maritime = firstOrNull(author.maritime_profiles)
  return {
    id: author.id,
    slug: author.slug,
    fullName: author.full_name,
    avatarPath: author.avatar_path,
    headline: author.headline,
    rank: maritime?.rank ?? null,
    currentCompany: maritime?.current_company ?? null,
  }
}

function mapComment(row: CommentRow): FeedComment {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    author: mapAuthor(row.profiles),
  }
}

export function mapFeedPost(
  row: FeedPostRow,
  viewer: FeedViewerState,
  signedUrls: Map<string, string> = new Map(),
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
  const comments = (row.post_comments ?? []).map(mapComment)

  return {
    id: row.id,
    category: row.category,
    body: row.body,
    postType: row.post_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: mapAuthor(row.profiles),
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
    likeCount: countRelation(row.post_reactions),
    commentCount: comments.length,
    viewerLiked: viewer.likedPostIds.has(row.id),
    viewerSaved: viewer.savedPostIds.has(row.id),
    comments,
  }
}
