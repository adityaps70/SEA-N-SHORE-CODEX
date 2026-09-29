import { organizationsMemberCanPostFor, type AccessContext } from '@/features/access/policy'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser, type AwsVerifiedUser } from '@/features/auth/aws-queries'
import { communityRepository } from '@/features/community/repository'
import { getPreferredFeedAuthorIds } from '@/features/network/queries'
import { resolveFeedMediaUrls } from './media'
import { feedAuthorAvatarPath, feedPhotoTagAvatarPaths, feedPostMediaPaths, hiddenPostPaths, mapFeedPost, mapHiddenPost, organizationLogoUrl, type FeedCommentRow, type FeedPostRow } from './mappers'
import { postPermissions } from './post-permissions'
import { prioritizeRecentFeedRows } from './ranking'
import { feedRepository, type FeedRepository } from './repository'
import { feedRequestSchema } from './schemas'
import type { FeedComment, FeedCursor, FeedPage, FeedPost, FeedRequest, HiddenPost, PostingOrganization } from './types'

type RequireUser = () => Promise<AwsVerifiedUser>
type LoadAccessContext = (profileId: string) => Promise<AccessContext>
type ResolveMediaUrls = (paths: string[]) => Promise<Map<string, string>>
type GetPreferredAuthorIds = () => Promise<Iterable<string>>
type ListAdministeredGroupIds = (viewerId: string) => Promise<string[]>

export type CommentActivity = { post: FeedPost; viewerComments: FeedComment[] }

export function buildFeedCursorFilter(cursor: FeedCursor) {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
}

export function feedNextCursor(pageRows: readonly Pick<FeedPostRow, 'created_at' | 'id'>[], hasMore: boolean): FeedCursor | null {
  const tail = pageRows.at(-1)
  return hasMore && tail ? { createdAt: tail.created_at, id: tail.id } : null
}

export function feedRowAuthorId(row: Pick<FeedPostRow, 'profiles'>) {
  const author = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
  return author?.id ?? ''
}

function repostSourceIds(rows: FeedPostRow[]) {
  return [...new Set(rows.flatMap((row) => row.repost_of_post_id ? [row.repost_of_post_id] : []))]
}

export function createFeedQueries(input: {
  requireUser: RequireUser
  repository: FeedRepository
  getPreferredAuthorIds: GetPreferredAuthorIds
  resolveMediaUrls: ResolveMediaUrls
  loadAccessContext?: LoadAccessContext
  /** Community groups the viewer administers (round 9B); their posts get "Remove from group". */
  listAdministeredGroupIds?: ListAdministeredGroupIds
}) {
  const loadAccessContext = input.loadAccessContext ?? getAccessContext
  const listAdministeredGroupIds = input.listAdministeredGroupIds ?? communityRepository.listAdministeredGroupIds

  /** Group admins may remove posts from their group; only then do we load the viewer's admin groups. */
  async function applyGroupModeration(posts: FeedPost[], viewerId: string) {
    if (!posts.some((post) => post.group)) return posts
    let groupIds: string[] = []
    try {
      groupIds = await listAdministeredGroupIds(viewerId)
    } catch {
      groupIds = []
    }
    if (!groupIds.length) return posts
    const administered = new Set(groupIds)
    return posts.map((post) => post.group && administered.has(post.group.id) ? { ...post, viewerCanModerateGroup: true } : post)
  }

  /** Organization admins may edit and delete their organization's posts; only then do we load roles. */
  async function applyOrganizationPermissions(rows: FeedPostRow[], posts: FeedPost[], viewerId: string) {
    if (!rows.some((row) => row.company_id)) return posts
    let access: AccessContext | null = null
    try {
      access = await loadAccessContext(viewerId)
    } catch {
      access = null
    }
    return posts.map((post, index) => {
      const companyId = rows[index]?.company_id ?? null
      if (!companyId) return post
      const permissions = postPermissions(access, viewerId, { authorId: post.author.id, companyId })
      return { ...post, viewerCanEdit: permissions.canEdit, viewerCanDelete: permissions.canDelete }
    })
  }

  async function hydratePosts(rows: FeedPostRow[], viewerId: string): Promise<FeedPost[]> {
    if (!rows.length) return []
    const postIds = rows.map((row) => row.id)
    const sourceIds = repostSourceIds(rows)
    const allViewerStateIds = [...new Set([...postIds, ...sourceIds])]
    const [viewer, comments, repostSources] = await Promise.all([
      input.repository.getViewerState(viewerId, allViewerStateIds),
      input.repository.getComments(postIds, viewerId),
      sourceIds.length ? input.repository.listRepostSourceRows(viewerId, sourceIds) : Promise.resolve([]),
    ])
    const paths = [...new Set([
      ...rows.flatMap(feedPostMediaPaths),
      ...rows.flatMap(feedPhotoTagAvatarPaths),
      ...rows.map((row) => feedAuthorAvatarPath(row.profiles)),
      ...repostSources.flatMap(feedPostMediaPaths),
      ...repostSources.map((row) => feedAuthorAvatarPath(row.profiles)),
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
    const sourceById = new Map(repostSources.map((row) => [row.id, row] as const))
    const posts = rows.map((row) => mapFeedPost({
      ...row,
      post_comments: commentsByPost.get(row.id) ?? [],
      repost_source: row.repost_of_post_id ? sourceById.get(row.repost_of_post_id) ?? null : null,
    }, viewer, signedUrls, viewerId))
    return applyGroupModeration(await applyOrganizationPermissions(rows, posts, viewerId), viewerId)
  }

  async function hydratePublicPosts(rows: FeedPostRow[], viewerId: string): Promise<FeedPost[]> {
    if (!rows.length) return []
    const postIds = rows.map((row) => row.id)
    const sourceIds = repostSourceIds(rows)
    const [comments, repostSources] = await Promise.all([
      input.repository.getComments(postIds),
      sourceIds.length ? input.repository.listRepostSourceRows(viewerId, sourceIds) : Promise.resolve([]),
    ])
    const paths = [...new Set([
      ...rows.flatMap(feedPostMediaPaths),
      ...rows.flatMap(feedPhotoTagAvatarPaths),
      ...rows.map((row) => feedAuthorAvatarPath(row.profiles)),
      ...repostSources.flatMap(feedPostMediaPaths),
      ...repostSources.map((row) => feedAuthorAvatarPath(row.profiles)),
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
    const sourceById = new Map(repostSources.map((row) => [row.id, row] as const))
    const emptyViewer = { postReactions: new Map(), likedPostIds: new Set<string>(), savedPostIds: new Set<string>(), pollVotes: new Map<string, string>() }
    return rows.map((row) => mapFeedPost({
      ...row,
      post_comments: commentsByPost.get(row.id) ?? [],
      repost_source: row.repost_of_post_id ? sourceById.get(row.repost_of_post_id) ?? null : null,
    }, emptyViewer, signedUrls))
  }

  async function getFeedPage(request: FeedRequest = {}): Promise<FeedPage> {
    const parsed = feedRequestSchema.parse(request)
    const user = await input.requireUser()
    const rows = await input.repository.listFeedRows({
      viewerProfileId: user.id,
      ...(parsed.category ? { category: parsed.category } : {}),
      ...(parsed.companyId ? { companyId: parsed.companyId } : {}),
      ...(parsed.groupId ? { groupId: parsed.groupId } : {}),
      ...(parsed.hashtag ? { hashtag: parsed.hashtag } : {}),
      ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
      limit: parsed.limit + 1,
    })
    const hasMore = rows.length > parsed.limit
    const pageRows = rows.slice(0, parsed.limit)
    const nextCursor = feedNextCursor(pageRows, hasMore)
    // An organization's own post list and a group feed stay newest first.
    if (parsed.companyId || parsed.groupId || parsed.hashtag) return { posts: await hydratePosts(pageRows, user.id), nextCursor }
    const preferredAuthorIds = new Set(await input.getPreferredAuthorIds())
    preferredAuthorIds.add(user.id)
    const displayRows = prioritizeRecentFeedRows(
      pageRows,
      preferredAuthorIds,
      feedRowAuthorId,
      (row) => Boolean(row.viewer_follows_organization),
    )
    return { posts: await hydratePosts(displayRows, user.id), nextCursor }
  }

  /** Organizations the signed-in member may publish posts for ("Post as"). */
  async function getPostingOrganizations(): Promise<PostingOrganization[]> {
    const user = await input.requireUser()
    const access = await loadAccessContext(user.id)
    const companyIds = organizationsMemberCanPostFor(access)
    if (!companyIds.length) return []
    const companies = await input.repository.listCompanyIdentities(companyIds)
    return companies.map((company) => ({
      id: company.id,
      slug: company.slug,
      name: company.name,
      logoUrl: organizationLogoUrl(company.id, company.logoPath),
    }))
  }

  async function getSavedPosts(): Promise<FeedPost[]> {
    const user = await input.requireUser()
    return hydratePosts(await input.repository.listSavedRows({ viewerProfileId: user.id, limit: 50 }), user.id)
  }

  async function getPostsByAuthor(authorProfileId: string): Promise<FeedPost[]> {
    const user = await input.requireUser()
    const rows = await input.repository.listAuthorRows({ viewerProfileId: user.id, authorProfileId, limit: 30, personalOnly: true })
    return hydratePosts(rows, user.id)
  }

  async function getPublicPostsByAuthor(authorProfileId: string): Promise<FeedPost[]> {
    const rows = await input.repository.listAuthorRows({ viewerProfileId: authorProfileId, authorProfileId, limit: 30, personalOnly: true })
    return hydratePublicPosts(rows, authorProfileId)
  }

  async function getMyActivityPosts(): Promise<FeedPost[]> {
    const user = await input.requireUser()
    const rows = await input.repository.listAuthorRows({ viewerProfileId: user.id, authorProfileId: user.id })
    return hydratePosts(rows, user.id)
  }

  async function getMyRecentlyDeletedPosts() {
    const user = await input.requireUser()
    return input.repository.listOwnRecentlyDeletedPosts(user.id)
  }

  /** Posts the signed-in member hid from their feed, newest hide first. */
  async function getMyHiddenPosts(): Promise<HiddenPost[]> {
    const user = await input.requireUser()
    const rows = await input.repository.listHiddenPosts(user.id, 50)
    if (!rows.length) return []
    const signedUrls = await input.resolveMediaUrls([...new Set(rows.flatMap(hiddenPostPaths))])
    return rows.flatMap((row) => {
      const post = mapHiddenPost(row, signedUrls)
      return post ? [post] : []
    })
  }

  async function getMyCommentActivity(): Promise<CommentActivity[]> {
    const user = await input.requireUser()
    const rows = await input.repository.listCommentedRows({ viewerProfileId: user.id })
    const posts = await hydratePosts(rows, user.id)
    return posts.map((post) => ({ post, viewerComments: post.comments.filter((comment) => comment.author.id === user.id) }))
  }

  async function getPostById(id: string): Promise<FeedPost | null> {
    const user = await input.requireUser()
    const row = await input.repository.getPostRow(user.id, id)
    if (!row) return null
    const [post] = await hydratePosts([row], user.id)
    return post ?? null
  }

  return { getFeedPage, getPostingOrganizations, getSavedPosts, getPostsByAuthor, getPublicPostsByAuthor, getMyActivityPosts, getMyRecentlyDeletedPosts, getMyHiddenPosts, getMyCommentActivity, getPostById }
}

const productionQueries = createFeedQueries({
  requireUser: requireAwsUser,
  repository: feedRepository,
  getPreferredAuthorIds: getPreferredFeedAuthorIds,
  resolveMediaUrls: resolveFeedMediaUrls,
})

export const getFeedPage = productionQueries.getFeedPage
export const getPostingOrganizations = productionQueries.getPostingOrganizations
export const getSavedPosts = productionQueries.getSavedPosts
export const getPostsByAuthor = productionQueries.getPostsByAuthor
export const getPublicPostsByAuthor = productionQueries.getPublicPostsByAuthor
export const getMyActivityPosts = productionQueries.getMyActivityPosts
export const getMyRecentlyDeletedPosts = productionQueries.getMyRecentlyDeletedPosts
export const getMyHiddenPosts = productionQueries.getMyHiddenPosts
export const getMyCommentActivity = productionQueries.getMyCommentActivity
export const getPostById = productionQueries.getPostById
