import { requireUser } from '@/features/auth/queries'
import { getPreferredFeedAuthorIds } from '@/features/network/queries'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { feedRequestSchema } from './schemas'
import { mapFeedPost, type FeedCommentRow, type FeedPostRow, type FeedViewerState } from './mappers'
import { prioritizeRecentFeedRows } from './ranking'
import type { FeedCursor, FeedPage, FeedPost, FeedRequest } from './types'

const FEED_POST_SELECT = `
  id,
  category,
  body,
  post_type,
  created_at,
  updated_at,
  profiles!posts_author_id_fkey (
    id,
    slug,
    full_name,
    avatar_path,
    headline,
    maritime_profiles (rank, current_company)
  ),
  post_media (storage_path, mime_type, alt_text),
  post_polls (
    post_poll_options (
      id,
      label,
      position,
      post_poll_votes (count)
    )
  ),
  post_reactions (count),
  post_comment_count:post_comments (count)
` as const

const COMMENT_SELECT = `
  id,
  post_id,
  body,
  created_at,
  profiles!post_comments_author_id_fkey (
    id,
    slug,
    full_name,
    avatar_path,
    headline,
    maritime_profiles (rank, current_company)
  )
` as const

export function buildFeedCursorFilter(cursor: FeedCursor) {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
}

export function feedRowAuthorId(row: Pick<FeedPostRow, 'profiles'>) {
  const author = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
  return author?.id ?? ''
}

function mediaPath(row: FeedPostRow) {
  const value = row.post_media
  if (Array.isArray(value)) return value[0]?.storage_path ?? null
  return value?.storage_path ?? null
}

async function hydratePosts(
  rows: FeedPostRow[],
  viewerId: string,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
): Promise<FeedPost[]> {
  if (!rows.length) return []
  const postIds = rows.map((row) => row.id)

  const [liked, saved, votes, comments] = await Promise.all([
    supabase.from('post_reactions').select('post_id').eq('user_id', viewerId).in('post_id', postIds),
    supabase.from('saved_posts').select('post_id').eq('user_id', viewerId).in('post_id', postIds),
    supabase.from('post_poll_votes').select('post_id, option_id').eq('user_id', viewerId).in('post_id', postIds),
    supabase.from('post_comments').select(COMMENT_SELECT).in('post_id', postIds).order('created_at', { ascending: true }),
  ])

  if (liked.error || saved.error || votes.error || comments.error) {
    throw new Error('Unable to load your feed activity.')
  }

  const viewer: FeedViewerState = {
    likedPostIds: new Set((liked.data ?? []).map((item) => item.post_id)),
    savedPostIds: new Set((saved.data ?? []).map((item) => item.post_id)),
    pollVotes: new Map((votes.data ?? []).map((item) => [item.post_id, item.option_id])),
  }

  const commentsByPost = new Map<string, FeedCommentRow[]>()
  for (const comment of (comments.data ?? []) as unknown as FeedCommentRow[]) {
    if (!comment.post_id) continue
    const existing = commentsByPost.get(comment.post_id) ?? []
    existing.push(comment)
    commentsByPost.set(comment.post_id, existing)
  }

  const paths = [...new Set(rows.map(mediaPath).filter((path): path is string => Boolean(path)))]
  const signedUrls = new Map<string, string>()
  if (paths.length) {
    const { data } = await supabase.storage.from('post-media').createSignedUrls(paths, 3600)
    for (const signed of data ?? []) {
      if (signed.path && signed.signedUrl) signedUrls.set(signed.path, signed.signedUrl)
    }
  }

  return rows.map((row) => mapFeedPost(
    { ...row, post_comments: commentsByPost.get(row.id) ?? [] },
    viewer,
    signedUrls,
  ))
}

export async function getFeedPage(input: FeedRequest = {}): Promise<FeedPage> {
  const parsed = feedRequestSchema.parse(input)
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  let query = supabase
    .from('posts')
    .select(FEED_POST_SELECT)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(parsed.limit + 1)

  if (parsed.category) query = query.eq('category', parsed.category)
  if (parsed.cursor) query = query.or(buildFeedCursorFilter(parsed.cursor))

  const { data, error } = await query
  if (error) throw new Error('Unable to load the maritime feed.')

  const rows = (data ?? []) as unknown as FeedPostRow[]
  const hasMore = rows.length > parsed.limit
  const pageRows = rows.slice(0, parsed.limit)
  const tail = pageRows.at(-1)
  const preferredAuthorIds = await getPreferredFeedAuthorIds()
  const displayRows = prioritizeRecentFeedRows(pageRows, preferredAuthorIds, feedRowAuthorId)
  const posts = await hydratePosts(displayRows, user.id, supabase)

  return {
    posts,
    nextCursor: hasMore && tail ? { createdAt: tail.created_at, id: tail.id } : null,
  }
}

export async function getPostById(id: string): Promise<FeedPost | null> {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('posts')
    .select(FEED_POST_SELECT)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error('Unable to load this post.')
  if (!data) return null

  const [post] = await hydratePosts([data as unknown as FeedPostRow], user.id, supabase)
  return post ?? null
}
