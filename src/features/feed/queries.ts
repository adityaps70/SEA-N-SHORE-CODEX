import { requireAwsUser, type AwsVerifiedUser } from '@/features/auth/aws-queries'
import { getPreferredFeedAuthorIds } from '@/features/network/queries'
import { resolveFeedMediaUrls } from './media'
import { feedAuthorAvatarPath, mapFeedPost, type FeedCommentRow, type FeedPostRow } from './mappers'
import { prioritizeRecentFeedRows } from './ranking'
import { feedRepository, type FeedRepository } from './repository'
import { feedRequestSchema } from './schemas'
import type { FeedComment, FeedCursor, FeedPage, FeedPost, FeedRequest } from './types'

type RequireUser = () => Promise<AwsVerifiedUser>
type ResolveMediaUrls = (paths: string[]) => Promise<Map<string, string>>
type GetPreferredAuthorIds = () => Promise<Iterable<string>>

export type CommentActivity = {
  post: FeedPost
  viewerComments: FeedComment[]
}

export function buildFeedCursorFilter(cursor: FeedCursor) {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
}

export function feedNextCursor(
  pageRows: readonly Pick<FeedPostRow, 'created_at' | 'id'>[],
  hasMore: boolean,
): FeedCursor | null {
  const tail = pageRows.at(-1)
  return hasMore && tail ? { createdAt: tail.created_at, id: tail.id } : null
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

export function createFeedQueries(input: {
  requireUser: RequireUser
  repository: FeedRepository
  getPreferredAuthorIds: GetPreferredAuthorIds
  resolveMediaUrls: ResolveMediaUrls
}) {
  async function hydratePosts(rows: FeedPostRow[], viewerId: string): Promise<FeedPost[]> {
    if (!rows.length) return []
    const postIds = rows.map((row) => row.id)

    const [viewer, comments] = await Promise.all([
      input.repository.getViewerState(viewerId, postIds),
      input.repository.getComments(postIds),
    ])

    const paths = [...new Set([
      ...rows.map(mediaPath),
      ...rows.map((row) => feedAuthorAvatarPath(row.profiles)),
      ...comments.map((comment) => feedAuthorAvatarPath(comment.profiles)),
    ].filter((path): path is string => Boolean(path)))]
    const signedUrls = await input.resolveMediaUrls(paths)

    const commentsByPost = new Map<string, FeedCommentRow[]>()
    for (const comment of comments) {
      if (!comment.post_id) continue
      const existing = commentsByPost.get(comment.post_id) ?? []
      existing.push(comment)
      commentsByPost.set(comment.post_id, existing)
    }

    return rows.map((row) => mapFeedPost(
      { ...row, post_comments: commentsByPost.get(row.id) ?? [] },
      viewer,
      signedUrls,
      viewerId,
    ))
  }

  async function hydratePublicPosts(rows: FeedPostRow[]): Promise<FeedPost[]> {
    if (!rows.length) return []
    const postIds = rows.map((row) => row.id)
    const comments = await input.repository.getComments(postIds)
    const paths = [...new Set([
      ...rows.map(mediaPath),
      ...rows.map((row) => feedAuthorAvatarPath(row.profiles)),
      ...comments.map((comment) => feedAuthorAvatarPath(comment.profiles)),
    ].filter((path): path is string => Boolean(path)))]
    const signedUrls = await input.resolveMediaUrls(paths)
    const commentsByPost = new Map<string, FeedCommentRow[]>()
    for (const comment of comments) {
      if (!comment.post_id) continue
      const existing = commentsByPost.get(comment.post_id) ?? []
      existing.push(comment)
      commentsByPost.set(comment.post_id, existing)
    }
    const emptyViewer = { likedPostIds: new Set<string>(), savedPostIds: new Set<string>(), pollVotes: new Map<string, string>() }
    return rows.map((row) => mapFeedPost(
      { ...row, post_comments: commentsByPost.get(row.id) ?? [] },
      emptyViewer,
      signedUrls,
    ))
  }

  async function getFeedPage(request: FeedRequest = {}): Promise<FeedPage> {
    const parsed = feedRequestSchema.parse(request)
    const user = await input.requireUser()
    const rows = await input.repository.listFeedRows({
      viewerProfileId: user.id,
      ...(parsed.category ? { category: parsed.category } : {}),
      ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
      limit: parsed.limit + 1,
    })

    const hasMore = rows.length > parsed.limit
    const pageRows = rows.slice(0, parsed.limit)
    const nextCursor = feedNextCursor(pageRows, hasMore)
    const preferredAuthorIds = new Set(await input.getPreferredAuthorIds())
    preferredAuthorIds.add(user.id)
    const displayRows = prioritizeRecentFeedRows(pageRows, preferredAuthorIds, feedRowAuthorId)
    const posts = await hydratePosts(displayRows, user.id)
    return { posts, nextCursor }
  }

  async function getSavedPosts(): Promise<FeedPost[]> {
    const user = await input.requireUser()
    const rows = await input.repository.listSavedRows({ viewerProfileId: user.id, limit: 50 })
    return hydratePosts(rows, user.id)
  }

  async function getPostsByAuthor(authorProfileId: string): Promise<FeedPost[]> {
    const user = await input.requireUser()
    const rows = await input.repository.listAuthorRows({
      viewerProfileId: user.id,
      authorProfileId,
      limit: 30,
    })
    return hydratePosts(rows, user.id)
  }

  async function getPublicPostsByAuthor(authorProfileId: string): Promise<FeedPost[]> {
    const rows = await input.repository.listAuthorRows({
      viewerProfileId: authorProfileId,
      authorProfileId,
      limit: 30,
    })
    return hydratePublicPosts(rows)
  }

  async function getMyActivityPosts(): Promise<FeedPost[]> {
    const user = await input.requireUser()
    const rows = await input.repository.listAuthorRows({
      viewerProfileId: user.id,
      authorProfileId: user.id,
    })
    return hydratePosts(rows, user.id)
  }

  async function getMyCommentActivity(): Promise<CommentActivity[]> {
    const user = await input.requireUser()
    const rows = await input.repository.listCommentedRows({ viewerProfileId: user.id })
    const posts = await hydratePosts(rows, user.id)
    return posts.map((post) => ({
      post,
      viewerComments: post.comments.filter((comment) => comment.author.id === user.id),
    }))
  }

  async function getPostById(id: string): Promise<FeedPost | null> {
    const user = await input.requireUser()
    const row = await input.repository.getPostRow(user.id, id)
    if (!row) return null
    const [post] = await hydratePosts([row], user.id)
    return post ?? null
  }

  return {
    getFeedPage,
    getSavedPosts,
    getPostsByAuthor,
    getPublicPostsByAuthor,
    getMyActivityPosts,
    getMyCommentActivity,
    getPostById,
  }
}

const productionQueries = createFeedQueries({
  requireUser: requireAwsUser,
  repository: feedRepository,
  getPreferredAuthorIds: getPreferredFeedAuthorIds,
  resolveMediaUrls: resolveFeedMediaUrls,
})

export const getFeedPage = productionQueries.getFeedPage
export const getSavedPosts = productionQueries.getSavedPosts
export const getPostsByAuthor = productionQueries.getPostsByAuthor
export const getPublicPostsByAuthor = productionQueries.getPublicPostsByAuthor
export const getMyActivityPosts = productionQueries.getMyActivityPosts
export const getMyCommentActivity = productionQueries.getMyCommentActivity
export const getPostById = productionQueries.getPostById
