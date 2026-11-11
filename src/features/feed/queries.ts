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
import { feedPreferences, type createFeedPreferences } from './preferences'
import { rankingSwitches } from '@/features/ranking/switches'
import { incrementRankingMetric } from '@/features/signals/repository'
import { topFeed, type createTopFeed } from '@/features/ranking/top-feed'
import { jobShareRepository } from '@/features/jobs/share/share-repository'
import type { CursorPage, FeedComment, FeedCursor, FeedJobShare, FeedMode, FeedPage, FeedPost, FeedRequest, HiddenPost, PostingOrganization } from './types'

type RequireUser = () => Promise<AwsVerifiedUser>
type LoadAccessContext = (profileId: string) => Promise<AccessContext>
type ResolveMediaUrls = (paths: string[]) => Promise<Map<string, string>>
type GetPreferredAuthorIds = (authorIds: readonly string[]) => Promise<Iterable<string>>
type ListAdministeredGroupIds = (viewerId: string) => Promise<string[]>
type LoadJobShareCards = (postIds: string[]) => Promise<Map<string, FeedJobShare>>
type TopFeed = ReturnType<typeof createTopFeed>
type FeedPreferences = ReturnType<typeof createFeedPreferences>
type RankingGate = { isEnabled(area: 'feed', profileId: string): Promise<boolean>; isAdministrator(profileId: string): Promise<boolean> }

/** Round G: feed pages show the top 2 comments of each post; the rest load on demand. */
export const FEED_COMMENT_PREVIEW = 2

/**
 * What Home shows: the old feed (switch off), or the member's mode. Top for you has no server page:
 * it loads in the browser, so the page refresh after a reaction never builds a new snapshot.
 */
export type HomeFeed = { mode: 'v1'; page: FeedPage } | { mode: 'recent'; page: FeedPage } | { mode: 'top'; page: null }

/** The original post of a repost, or the post itself: reposts of the same content collapse. */
export function feedContentId(post: Pick<FeedPost, 'id' | 'repostOf'>) {
  return post.repostOf?.id ?? post.id
}

export type CommentActivity = { post: FeedPost; viewerComments: FeedComment[] }

/** Round F: what the post page shows. */
export type PostPage =
  | { kind: 'member'; post: FeedPost }
  | { kind: 'public'; post: FeedPost }
  | { kind: 'members_only' }
  | { kind: 'missing' }

const POST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isPostId(value: string) {
  return POST_ID_PATTERN.test(value)
}

/** Round 14 (3.7): My Activities lists (posts, comments) load 20 at a time. */
export const ACTIVITY_PAGE_SIZE = 20

export type ActivityPostsPage = CursorPage<FeedPost>
export type CommentActivityPage = CursorPage<CommentActivity>

export function buildFeedCursorFilter(cursor: FeedCursor) {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
}

type CursorRow = Pick<FeedPostRow, 'created_at' | 'id'> & Pick<Partial<FeedPostRow>, 'cursor_at'>

/**
 * A row's keyset position: the list's sort timestamp (exact text from the repository's `cursor_at`,
 * falling back to `created_at`) and the post id as the tie-break.
 */
export function feedRowCursor(row: CursorRow): FeedCursor {
  return { createdAt: row.cursor_at ?? row.created_at, id: row.id }
}

export function feedNextCursor(pageRows: readonly CursorRow[], hasMore: boolean): FeedCursor | null {
  const tail = pageRows.at(-1)
  return hasMore && tail ? feedRowCursor(tail) : null
}

/** Fetch one more row than the page size: its presence says whether there is a next page. */
function splitPage<Row extends CursorRow>(rows: readonly Row[], pageSize: number) {
  const hasMore = rows.length > pageSize
  const pageRows = rows.slice(0, pageSize)
  return { pageRows, nextCursor: feedNextCursor(pageRows, hasMore) }
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
  topFeed?: TopFeed
  preferences?: FeedPreferences
  ranking?: RankingGate
  /** Round I (I1): job cards of posts made with "Share to feed", by post id. */
  loadJobShareCards?: LoadJobShareCards
}) {
  const rankedFeed = input.topFeed ?? topFeed
  const preferences = input.preferences ?? feedPreferences
  const ranking: RankingGate = input.ranking ?? rankingSwitches
  const loadAccessContext = input.loadAccessContext ?? getAccessContext
  const listAdministeredGroupIds = input.listAdministeredGroupIds ?? communityRepository.listAdministeredGroupIds
  const loadJobShareCards = input.loadJobShareCards ?? jobShareRepository.listFeedJobCards

  /** Round I (I1): the job card of each post shared from a job. A failure only leaves the cards out. */
  async function applyJobShares(posts: FeedPost[]) {
    if (!posts.length) return posts
    let cards: Map<string, FeedJobShare>
    try {
      cards = await loadJobShareCards(posts.map((post) => post.id))
    } catch {
      return posts
    }
    if (!cards.size) return posts
    return posts.map((post) => (cards.has(post.id) ? { ...post, jobShare: cards.get(post.id)! } : post))
  }

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

  /**
   * `commentPreview`: load only the top N comments of each post (feed pages, round G); the post says
   * `commentsComplete: false` and the rest load on demand. Without it, every comment is loaded.
   */
  async function hydratePosts(rows: FeedPostRow[], viewerId: string, options: { commentPreview?: number } = {}): Promise<FeedPost[]> {
    if (!rows.length) return []
    const postIds = rows.map((row) => row.id)
    const sourceIds = repostSourceIds(rows)
    const allViewerStateIds = [...new Set([...postIds, ...sourceIds])]
    const [viewer, comments, repostSources] = await Promise.all([
      input.repository.getViewerState(viewerId, allViewerStateIds),
      options.commentPreview
        ? input.repository.getCommentPreview(postIds, viewerId, options.commentPreview)
        : input.repository.getComments(postIds, viewerId),
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
    const posts = rows.map((row) => {
      const post = mapFeedPost({
        ...row,
        post_comments: commentsByPost.get(row.id) ?? [],
        repost_source: row.repost_of_post_id ? sourceById.get(row.repost_of_post_id) ?? null : null,
      }, viewer, signedUrls, viewerId)
      if (!options.commentPreview) return post
      const loaded = (commentsByPost.get(row.id) ?? []).filter((comment) => !comment.deleted_at).length
      return { ...post, commentsComplete: loaded >= post.commentCount }
    })
    return applyJobShares(await applyGroupModeration(await applyOrganizationPermissions(rows, posts, viewerId), viewerId))
  }

  /**
   * Posts for a signed-out page (round F): no viewer state, no comments (they stay behind sign-in; the
   * counts still show), and reposted originals only when they are readable signed out too.
   */
  async function hydratePublicPosts(rows: FeedPostRow[]): Promise<FeedPost[]> {
    if (!rows.length) return []
    const sourceIds = repostSourceIds(rows)
    const repostSources = sourceIds.length ? await input.repository.listPublicRepostSourceRows(sourceIds) : []
    const paths = [...new Set([
      ...rows.flatMap(feedPostMediaPaths),
      ...rows.flatMap(feedPhotoTagAvatarPaths),
      ...rows.map((row) => feedAuthorAvatarPath(row.profiles)),
      ...repostSources.flatMap(feedPostMediaPaths),
      ...repostSources.map((row) => feedAuthorAvatarPath(row.profiles)),
    ].filter((path): path is string => Boolean(path)))]
    const signedUrls = await input.resolveMediaUrls(paths)
    const sourceById = new Map(repostSources.map((row) => [row.id, row] as const))
    const emptyViewer = { postReactions: new Map(), likedPostIds: new Set<string>(), savedPostIds: new Set<string>(), pollVotes: new Map<string, string>() }
    return applyJobShares(rows.map((row) => ({
      ...mapFeedPost({
        ...row,
        post_comments: [],
        repost_source: row.repost_of_post_id ? sourceById.get(row.repost_of_post_id) ?? null : null,
      }, emptyViewer, signedUrls),
      comments: [],
    })))
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
    // Round DB: only the authors on this page are looked up (the only ones the ordering below asks about).
    const preferredAuthorIds = new Set(await input.getPreferredAuthorIds(pageRows.map(feedRowAuthorId)))
    preferredAuthorIds.add(user.id)
    const displayRows = prioritizeRecentFeedRows(
      pageRows,
      preferredAuthorIds,
      feedRowAuthorId,
      (row) => Boolean(row.viewer_follows_organization),
    )
    return { posts: await hydratePosts(displayRows, user.id), nextCursor }
  }

  /**
   * Round G: one page of "Top for you". No session: a new visit (reload / refresh) and a new snapshot
   * without anything seen so far. The posts are re-checked against every feed rule when loaded.
   */
  async function getTopFeedPage(request: { sessionId?: string; position?: number; debug?: boolean } = {}): Promise<FeedPage> {
    const user = await input.requireUser()
    const result = await rankedFeed.page({
      viewerId: user.id,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      ...(request.position !== undefined ? { position: request.position } : {}),
    })
    const rows = await input.repository.listRowsByIds(user.id, result.postIds)
    const byId = new Map(rows.map((row) => [row.id, row] as const))
    const ordered = result.postIds.flatMap((id) => {
      const row = byId.get(id)
      return row ? [row] : []
    })
    const showDebug = Boolean(request.debug) && await ranking.isAdministrator(user.id)
    const posts = (await hydratePosts(ordered, user.id, { commentPreview: FEED_COMMENT_PREVIEW })).map((post) => {
      const meta = result.session.meta.entries[post.id]
      if (!meta) return post
      return {
        ...post,
        rank: {
          reasons: meta.reasons,
          repostedBy: meta.repostedBy,
          debug: showDebug && meta.debug ? { version: result.session.meta.version, ...meta.debug } : null,
        },
      }
    })
    if (request.position === undefined) void incrementRankingMetric('feed.top_pages', 1, user.id)
    return {
      posts,
      nextCursor: null,
      top: {
        sessionId: result.session.id,
        visitId: result.session.visitId,
        nextPosition: result.nextPosition,
        stage: result.session.stage,
        caughtUp: result.caughtUp,
        coldStart: result.session.meta.coldStart,
        snapshotAt: result.session.createdAt.toISOString(),
      },
    }
  }

  /**
   * Round G: Recent stays a true newest-first timeline (so it can show posts already seen), with
   * mutes applied, reposts of the same content collapsed, and the "New since your last visit" divider.
   */
  async function getRecentFeedPage(request: FeedRequest = {}): Promise<FeedPage> {
    const parsed = feedRequestSchema.parse(request)
    const user = await input.requireUser()
    const rows = await input.repository.listFeedRows({
      viewerProfileId: user.id,
      ...(parsed.category ? { category: parsed.category } : {}),
      ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
      limit: parsed.limit + 1,
      applyMutes: true,
    })
    const hasMore = rows.length > parsed.limit
    const pageRows = rows.slice(0, parsed.limit)
    const nextCursor = feedNextCursor(pageRows, hasMore)
    const seenContent = new Set<string>()
    const uniqueRows = pageRows.filter((row) => {
      const contentId = row.repost_of_post_id ?? row.id
      if (seenContent.has(contentId)) return false
      seenContent.add(contentId)
      return true
    })
    const posts = await hydratePosts(uniqueRows, user.id, { commentPreview: FEED_COMMENT_PREVIEW })
    let dividerBeforePostId: string | null = null
    if (!parsed.cursor) {
      const previousVisit = await preferences.touchVisit(user.id).catch(() => null)
      if (previousVisit) {
        const index = posts.findIndex((post) => new Date(post.createdAt).getTime() <= previousVisit.getTime())
        dividerBeforePostId = index > 0 ? posts[index]!.id : null
      }
      void incrementRankingMetric('feed.recent_pages', 1, user.id)
    }
    return { posts, nextCursor, recent: { dividerBeforePostId } }
  }

  /**
   * Home: the old feed when the feed switch is off for this member (v1), otherwise their chosen mode
   * (Top for you by default). A category filter always shows newest first.
   */
  async function getHomeFeed(request: { category?: FeedRequest['category'] } = {}): Promise<HomeFeed> {
    const user = await input.requireUser()
    const enabled = await ranking.isEnabled('feed', user.id)
    if (!enabled) return { mode: 'v1', page: await getFeedPage(request.category ? { category: request.category } : {}) }
    if (request.category) return { mode: 'recent', page: await getRecentFeedPage({ category: request.category }) }
    const preference = await preferences.get(user.id).catch(() => ({ mode: null }))
    const mode: FeedMode = preference.mode ?? 'top'
    return mode === 'top' ? { mode, page: null } : { mode, page: await getRecentFeedPage({}) }
  }

  /** Every comment of one post (the "View all comments" on a feed card). */
  async function getAllPostComments(postId: string): Promise<FeedComment[] | null> {
    const post = await getPostById(postId)
    return post ? post.comments : null
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

  /**
   * An author's posts for their profile page seen signed out: only posts they chose to show to anyone
   * (round F). It used to list them as the author saw them, which included private-community posts.
   */
  async function getPublicPostsByAuthor(authorProfileId: string): Promise<FeedPost[]> {
    return hydratePublicPosts(await input.repository.listPublicAuthorRows(authorProfileId, 30))
  }

  /** The signed-in member's own posts, newest first, 20 per page (keyset cursor: created_at, id). */
  async function getMyActivityPosts(cursor?: FeedCursor): Promise<ActivityPostsPage> {
    const user = await input.requireUser()
    const rows = await input.repository.listAuthorRows({
      viewerProfileId: user.id,
      authorProfileId: user.id,
      ...(cursor ? { cursor } : {}),
      limit: ACTIVITY_PAGE_SIZE + 1,
    })
    const { pageRows, nextCursor } = splitPage(rows, ACTIVITY_PAGE_SIZE)
    const posts = await hydratePosts(pageRows, user.id)
    return { entries: posts.map((post, index) => ({ cursor: feedRowCursor(pageRows[index]!), item: post })), nextCursor }
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

  /**
   * Posts the signed-in member commented on, latest comment first, 20 per page
   * (keyset cursor: the member's latest comment time on the post, post id).
   */
  async function getMyCommentActivity(cursor?: FeedCursor): Promise<CommentActivityPage> {
    const user = await input.requireUser()
    const rows = await input.repository.listCommentedRows({
      viewerProfileId: user.id,
      ...(cursor ? { cursor } : {}),
      limit: ACTIVITY_PAGE_SIZE + 1,
    })
    const { pageRows, nextCursor } = splitPage(rows, ACTIVITY_PAGE_SIZE)
    const posts = await hydratePosts(pageRows, user.id)
    return {
      entries: posts.map((post, index) => ({
        cursor: feedRowCursor(pageRows[index]!),
        item: { post, viewerComments: post.comments.filter((comment) => comment.author.id === user.id) },
      })),
      nextCursor,
    }
  }

  async function getPostById(id: string): Promise<FeedPost | null> {
    // Round F: a malformed id is a missing post (404), not a database error (500).
    if (!isPostId(id)) return null
    const user = await input.requireUser()
    const row = await input.repository.getPostRow(user.id, id)
    if (!row) return null
    const [post] = await hydratePosts([row], user.id)
    return post ?? null
  }

  /**
   * The post page for anyone (round F). Signed in: the member rule (plus the tagged-member exception).
   * Signed out: an "Anyone" post read-only, a teaser for any other live post (no content), or missing.
   */
  async function getPostPage(id: string, viewer: { id: string } | null): Promise<PostPage> {
    if (!isPostId(id)) return { kind: 'missing' }
    if (viewer) {
      const row = await input.repository.getPostRow(viewer.id, id)
      if (row) {
        const [post] = await hydratePosts([row], viewer.id)
        if (post) return { kind: 'member', post }
      }
      // Signed in, the member rule decides alone: a block or a private community hides the post.
      return { kind: 'missing' }
    }
    const row = await input.repository.getPublicPostRow(id)
    if (row) {
      const [post] = await hydratePublicPosts([row])
      if (post) return { kind: 'public', post }
    }
    return await input.repository.postExists(id) ? { kind: 'members_only' } : { kind: 'missing' }
  }

  return { getFeedPage, getTopFeedPage, getRecentFeedPage, getHomeFeed, getAllPostComments, getPostingOrganizations, getSavedPosts, getPostsByAuthor, getPublicPostsByAuthor, getMyActivityPosts, getMyRecentlyDeletedPosts, getMyHiddenPosts, getMyCommentActivity, getPostById, getPostPage }
}

const productionQueries = createFeedQueries({
  requireUser: requireAwsUser,
  repository: feedRepository,
  getPreferredAuthorIds: getPreferredFeedAuthorIds,
  resolveMediaUrls: resolveFeedMediaUrls,
})

export const getFeedPage = productionQueries.getFeedPage
export const getTopFeedPage = productionQueries.getTopFeedPage
export const getRecentFeedPage = productionQueries.getRecentFeedPage
export const getHomeFeed = productionQueries.getHomeFeed
export const getAllPostComments = productionQueries.getAllPostComments
export const getPostingOrganizations = productionQueries.getPostingOrganizations
export const getSavedPosts = productionQueries.getSavedPosts
export const getPostsByAuthor = productionQueries.getPostsByAuthor
export const getPublicPostsByAuthor = productionQueries.getPublicPostsByAuthor
export const getMyActivityPosts = productionQueries.getMyActivityPosts
export const getMyRecentlyDeletedPosts = productionQueries.getMyRecentlyDeletedPosts
export const getMyHiddenPosts = productionQueries.getMyHiddenPosts
export const getMyCommentActivity = productionQueries.getMyCommentActivity
export const getPostById = productionQueries.getPostById
export const getPostPage = productionQueries.getPostPage
