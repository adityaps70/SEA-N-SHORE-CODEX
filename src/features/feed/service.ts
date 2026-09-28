import { randomUUID } from 'node:crypto'
import { canPostAsOrganization, type AccessContext } from '@/features/access/policy'
import { getAccessContext } from '@/features/access/server'
import { withTransaction as databaseTransaction } from '@/lib/db/client'
import { resolveFeedMediaUrls } from './media'
import { postPermissions } from './post-permissions'
import { REPOST_COMMENTARY_MAX } from './schemas'
import {
  createFeedRepositoryForClient,
  type FeedMediaInput,
  type FeedRepository,
} from './repository'
import { createFeedSocialWriterForClient, type FeedSocialWriter } from './social-writer'
import type { PostCategory, PostReactionType, ReactionDetailsPage, ReactionTargetType } from './types'

type FeedTransaction = <T>(fn: (repository: FeedRepository, social?: FeedSocialWriter) => Promise<T>) => Promise<T>

type StandardPostInput = {
  id?: string
  category: PostCategory
  body: string
  media?: FeedMediaInput[]
  mentionProfileIds?: string[]
  /** Publish as this organization; the actor must be allowed to post for it. */
  companyId?: string
}

type UpdatePostInput = {
  body: string
  mentionProfileIds?: string[]
}

type PollPostInput = Omit<StandardPostInput, 'id' | 'media'> & {
  pollOptions: string[]
}

type RepostInput = {
  body?: string
  mentionProfileIds?: string[]
}

type ReactionDetailsRequest = {
  targetType: ReactionTargetType
  targetId: string
  reaction?: PostReactionType
  cursor?: string
  limit: number
}

type FeedInvalidationEventType =
  | 'feed.post_created'
  | 'feed.post_reaction_changed'
  | 'feed.post_comments_changed'
  | 'feed.post_reposted'

function serviceError(code: string): never {
  throw new Error(code)
}

function occurredAt() {
  return new Date().toISOString()
}

async function assertMemberReady(repository: FeedRepository, profileId: string) {
  if (!await repository.isMemberReady(profileId)) serviceError('feed_interaction_unavailable')
}

async function assertInteractablePost(repository: FeedRepository, viewerProfileId: string, postId: string) {
  const post = await repository.getInteractablePost({ viewerProfileId, postId })
  if (!post) serviceError('feed_interaction_unavailable')
  return post
}

async function assertOwnedComment(repository: FeedRepository, actorId: string, commentId: string) {
  const comment = await repository.getCommentForInteraction(actorId, commentId)
  if (!comment) serviceError('feed_interaction_unavailable')
  if (comment.authorId !== actorId) serviceError('feed_comment_mutation_forbidden')
  return comment
}

function normalizePollOptions(options: string[]) {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const rawOption of options) {
    const option = rawOption.trim()
    if (option.length < 1 || option.length > 120) continue
    const key = option.toLocaleLowerCase('en')
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(option)
  }
  if (normalized.length < 2 || normalized.length > 6) serviceError('feed_poll_options_invalid')
  return normalized
}

async function enqueueFeedInvalidation(
  social: FeedSocialWriter | undefined,
  eventType: FeedInvalidationEventType,
  actorId: string,
  postId: string,
) {
  if (!social) return
  switch (eventType) {
    case 'feed.post_created':
      await social.enqueue({
        id: randomUUID(),
        aggregateType: 'post',
        aggregateId: postId,
        eventType: 'feed.post_created',
        schemaVersion: 1,
        occurredAt: occurredAt(),
        payload: { eventType: 'feed.post_created', actorId, postId },
      })
      return
    case 'feed.post_reaction_changed':
      await social.enqueue({
        id: randomUUID(),
        aggregateType: 'post',
        aggregateId: postId,
        eventType: 'feed.post_reaction_changed',
        schemaVersion: 1,
        occurredAt: occurredAt(),
        payload: { eventType: 'feed.post_reaction_changed', actorId, postId },
      })
      return
    case 'feed.post_comments_changed':
      await social.enqueue({
        id: randomUUID(),
        aggregateType: 'post',
        aggregateId: postId,
        eventType: 'feed.post_comments_changed',
        schemaVersion: 1,
        occurredAt: occurredAt(),
        payload: { eventType: 'feed.post_comments_changed', actorId, postId },
      })
      return
    case 'feed.post_reposted':
      await social.enqueue({
        id: randomUUID(),
        aggregateType: 'post',
        aggregateId: postId,
        eventType: 'feed.post_reposted',
        schemaVersion: 1,
        occurredAt: occurredAt(),
        payload: { eventType: 'feed.post_reposted', actorId, postId },
      })
  }
}

async function notifyPostMentions(
  social: FeedSocialWriter | undefined,
  actorId: string,
  postId: string,
  recipients: string[],
) {
  if (!social) return
  for (const targetId of recipients) {
    const eventId = randomUUID()
    await social.upsertNotification({
      recipientId: targetId,
      actorId,
      type: 'post_mention',
      postId,
      dedupeKey: `post-mention:${postId}:${targetId}`,
    })
    await social.enqueue({
      id: eventId,
      aggregateType: 'post',
      aggregateId: postId,
      eventType: 'post.mentioned',
      schemaVersion: 1,
      occurredAt: occurredAt(),
      payload: { eventType: 'post.mentioned', actorId, targetId, postId },
    })
  }
}

async function notifyCommentMentions(
  social: FeedSocialWriter | undefined,
  actorId: string,
  postId: string,
  commentId: string,
  recipients: string[],
) {
  if (!social) return
  for (const targetId of recipients) {
    const eventId = randomUUID()
    await social.upsertNotification({
      recipientId: targetId,
      actorId,
      type: 'comment_mention',
      postId,
      commentId,
      dedupeKey: `comment-mention:${commentId}:${targetId}`,
    })
    await social.enqueue({
      id: eventId,
      aggregateType: 'comment',
      aggregateId: commentId,
      eventType: 'comment.mentioned',
      schemaVersion: 1,
      occurredAt: occurredAt(),
      payload: { eventType: 'comment.mentioned', actorId, targetId, postId, commentId },
    })
  }
}

export function createFeedService(input: {
  withTransaction: FeedTransaction
  createId?: () => string
  resolveMediaUrls?: (paths: string[]) => Promise<Map<string, string>>
  /** Roles and memberships, for posting as an organization. */
  loadAccessContext?: (profileId: string) => Promise<AccessContext>
}) {
  const createId = input.createId ?? randomUUID
  const resolveMediaUrls = input.resolveMediaUrls ?? resolveFeedMediaUrls
  const loadAccessContext = input.loadAccessContext ?? getAccessContext

  async function assertCanPostAsOrganization(actorId: string, companyId: string) {
    const access = await loadAccessContext(actorId)
    if (!canPostAsOrganization(access, companyId)) serviceError('feed_organization_post_forbidden')
  }

  /** Personal posts never need the access context: only their author may change them. */
  async function permissionsFor(actorId: string, post: { authorId: string; companyId: string | null }) {
    const access = post.companyId ? await loadAccessContext(actorId) : null
    return postPermissions(access, actorId, post)
  }

  async function createStandardPost(actorId: string, post: StandardPostInput) {
    return input.withTransaction(async (repository, social) => {
      await assertMemberReady(repository, actorId)
      if (post.companyId) await assertCanPostAsOrganization(actorId, post.companyId)
      const id = post.id ?? createId()
      await repository.insertStandardPost({
        id,
        authorId: actorId,
        category: post.category,
        body: post.body.trim(),
        ...(post.companyId ? { companyId: post.companyId } : {}),
      })
      for (const media of post.media ?? []) await repository.insertPostMedia(id, media)
      const mentions = post.mentionProfileIds?.length
        ? await repository.insertPostMentions(actorId, id, post.mentionProfileIds)
        : []
      await notifyPostMentions(social, actorId, id, mentions)
      await enqueueFeedInvalidation(social, 'feed.post_created', actorId, id)
      return id
    })
  }

  async function assertPendingMediaDiscardable(actorId: string, storagePath: string) {
    return input.withTransaction(async (repository) => {
      await assertMemberReady(repository, actorId)
      if (await repository.isPostMediaAttached(storagePath)) serviceError('feed_media_delete_forbidden')
      return true
    })
  }

  async function createPollPost(actorId: string, post: PollPostInput) {
    return input.withTransaction(async (repository, social) => {
      await assertMemberReady(repository, actorId)
      if (post.companyId) await assertCanPostAsOrganization(actorId, post.companyId)
      const options = normalizePollOptions(post.pollOptions)
      const id = createId()
      await repository.insertPollPost({
        id,
        authorId: actorId,
        category: post.category,
        body: post.body.trim(),
        ...(post.companyId ? { companyId: post.companyId } : {}),
      })
      for (const [position, label] of options.entries()) await repository.insertPollOption(id, label, position)
      const mentions = post.mentionProfileIds?.length
        ? await repository.insertPostMentions(actorId, id, post.mentionProfileIds)
        : []
      await notifyPostMentions(social, actorId, id, mentions)
      await enqueueFeedInvalidation(social, 'feed.post_created', actorId, id)
      return id
    })
  }

  async function repostPost(actorId: string, sourcePostId: string, repost: RepostInput = {}) {
    return input.withTransaction(async (repository, social) => {
      const source = await assertInteractablePost(repository, actorId, sourcePostId)
      if (source.postType === 'repost') serviceError('feed_repost_source_unavailable')
      const id = createId()
      const commentary = repost.body?.trim() ?? ''
      await repository.insertRepost(commentary
        ? { id, authorId: actorId, sourcePostId, body: commentary }
        : { id, authorId: actorId, sourcePostId })
      if (commentary && repost.mentionProfileIds?.length) {
        const mentions = await repository.insertPostMentions(actorId, id, repost.mentionProfileIds)
        await notifyPostMentions(social, actorId, id, mentions)
      }
      await enqueueFeedInvalidation(social, 'feed.post_reposted', actorId, id)
      return id
    })
  }

  async function setHidden(actorId: string, postId: string, hidden: boolean) {
    return input.withTransaction(async (repository) => {
      if (hidden) {
        const post = await assertInteractablePost(repository, actorId, postId)
        if (post.authorId === actorId) serviceError('feed_hide_own_post')
      } else {
        await assertMemberReady(repository, actorId)
      }
      await repository.setHidden(actorId, postId, hidden)
      return true
    })
  }

  /** Shows a hidden post in the member's feed again. Idempotent: false when it was not hidden. */
  async function unhidePost(actorId: string, postId: string) {
    return input.withTransaction(async (repository) => {
      await assertMemberReady(repository, actorId)
      return repository.deleteHide(actorId, postId)
    })
  }

  async function deletePost(actorId: string, postId: string) {
    return input.withTransaction(async (repository) => {
      await assertMemberReady(repository, actorId)
      if (await repository.deleteOwnPost(actorId, postId)) return true
      // Not the author: organization admins may remove posts published as their organization.
      const post = await repository.getPostForManagement(postId)
      if (!post?.companyId) serviceError('feed_post_delete_forbidden')
      const permissions = await permissionsFor(actorId, post)
      if (!permissions.canDelete) serviceError('feed_post_delete_forbidden')
      if (!await repository.deleteOrganizationPost(actorId, postId, post.companyId)) serviceError('feed_post_delete_forbidden')
      return true
    })
  }

  async function updatePost(actorId: string, postId: string, update: UpdatePostInput) {
    return input.withTransaction(async (repository, social) => {
      await assertMemberReady(repository, actorId)
      const post = await repository.getPostForManagement(postId)
      if (!post) serviceError('feed_interaction_unavailable')
      const permissions = await permissionsFor(actorId, post)
      if (!permissions.canEdit) serviceError('feed_post_edit_forbidden')
      const body = update.body.trim()
      // Reposts may drop their commentary; standard posts and polls always keep text.
      if (!body && post.postType !== 'repost') serviceError('feed_post_body_required')
      if (post.postType === 'repost' && body.length > REPOST_COMMENTARY_MAX) serviceError('feed_post_body_too_long')
      if (!await repository.updatePostBody(postId, body)) serviceError('feed_interaction_unavailable')
      const mentions = await repository.replacePostMentions(actorId, postId, body ? update.mentionProfileIds ?? [] : [])
      await notifyPostMentions(social, actorId, postId, mentions.newlyIntroducedProfileIds)
      return { id: postId, postType: post.postType }
    })
  }

  async function restoreDeletedPost(actorId: string, postId: string) {
    return input.withTransaction(async (repository) => {
      await assertMemberReady(repository, actorId)
      const companyId = await repository.getRestorablePostCompanyId(actorId, postId)
      if (companyId && !canPostAsOrganization(await loadAccessContext(actorId), companyId)) {
        serviceError('feed_post_restore_organization_forbidden')
      }
      if (!await repository.restoreOwnDeletedPost(actorId, postId)) {
        serviceError('feed_post_restore_unavailable')
      }
      return true
    })
  }

  async function getReactionDetails(actorId: string, request: ReactionDetailsRequest): Promise<ReactionDetailsPage> {
    const page = await input.withTransaction(async (repository) => {
      await assertMemberReady(repository, actorId)
      if (request.targetType === 'post') {
        await assertInteractablePost(repository, actorId, request.targetId)
      } else {
        const comment = await repository.getCommentForInteraction(actorId, request.targetId)
        if (!comment) serviceError('feed_interaction_unavailable')
      }
      return repository.listReactionDetails({ viewerProfileId: actorId, ...request })
    })

    const avatarPaths = [...new Set(page.rows.flatMap((row) => row.avatar_path ? [row.avatar_path] : []))]
    const signedUrls = await resolveMediaUrls(avatarPaths)
    return {
      reactors: page.rows.flatMap((row) => row.slug ? [{
        id: row.profile_id,
        slug: row.slug,
        fullName: row.full_name,
        avatarPath: row.avatar_path,
        avatarUrl: row.avatar_path ? signedUrls.get(row.avatar_path) ?? null : null,
        headline: row.headline,
        rank: row.rank,
        currentCompany: row.current_company,
        reaction: row.reaction_type,
        reactedAt: row.reacted_at,
      }] : []),
      nextCursor: page.nextCursor,
    }
  }

  async function setPostReaction(actorId: string, postId: string, reaction: PostReactionType | null) {
    return input.withTransaction(async (repository, social) => {
      const post = await assertInteractablePost(repository, actorId, postId)
      await repository.setPostReaction(actorId, postId, reaction)
      await enqueueFeedInvalidation(social, 'feed.post_reaction_changed', actorId, postId)
      if (!social || post.authorId === actorId) return true
      const dedupeKey = `post-reaction:${postId}:${actorId}`
      if (!reaction) {
        await social.deleteNotification(post.authorId, dedupeKey)
        return true
      }
      await social.upsertNotification({
        recipientId: post.authorId,
        actorId,
        type: 'post_reaction',
        postId,
        reactionType: reaction,
        dedupeKey,
      })
      await social.enqueue({
        id: randomUUID(),
        aggregateType: 'post',
        aggregateId: postId,
        eventType: 'post.reacted',
        schemaVersion: 1,
        occurredAt: occurredAt(),
        payload: { eventType: 'post.reacted', actorId, targetId: post.authorId, postId, reactionType: reaction },
      })
      return true
    })
  }

  async function setLiked(actorId: string, postId: string, liked: boolean) {
    return input.withTransaction(async (repository, social) => {
      await assertInteractablePost(repository, actorId, postId)
      await repository.setLiked(actorId, postId, liked)
      await enqueueFeedInvalidation(social, 'feed.post_reaction_changed', actorId, postId)
      return true
    })
  }

  async function setSaved(actorId: string, postId: string, saved: boolean) {
    return input.withTransaction(async (repository) => {
      await assertInteractablePost(repository, actorId, postId)
      await repository.setSaved(actorId, postId, saved)
      return true
    })
  }

  async function addComment(
    actorId: string,
    postId: string,
    body: string,
    parentCommentId: string | null = null,
    mentionProfileIds: string[] = [],
  ) {
    return input.withTransaction(async (repository, social) => {
      const post = await assertInteractablePost(repository, actorId, postId)
      let normalizedParentId: string | null = null
      let replyRecipientId: string | null = null
      let replyToCommentId: string | null = null
      let directReplyRecipientId: string | null = null
      if (parentCommentId) {
        const parent = await repository.getCommentForInteraction(actorId, parentCommentId)
        if (!parent || parent.postId !== postId) serviceError('feed_comment_parent_unavailable')
        normalizedParentId = parent.rootParentId
        const root = parent.rootParentId === parent.id
          ? parent
          : await repository.getCommentForInteraction(actorId, parent.rootParentId)
        if (!root || root.postId !== postId) serviceError('feed_comment_parent_unavailable')
        replyRecipientId = root.authorId
        if (parent.id !== root.id) {
          // A reply to a reply stays in the same thread but remembers who it answers.
          replyToCommentId = parent.id
          directReplyRecipientId = parent.authorId
        }
      }
      const commentId = replyToCommentId
        ? await repository.addComment(actorId, postId, body.trim(), normalizedParentId, replyToCommentId)
        : await repository.addComment(actorId, postId, body.trim(), normalizedParentId)
      const mentions = mentionProfileIds.length
        ? await repository.insertCommentMentions(actorId, commentId, mentionProfileIds)
        : []

      if (social && normalizedParentId && replyRecipientId && replyRecipientId !== actorId) {
        await social.upsertNotification({
          recipientId: replyRecipientId,
          actorId,
          type: 'comment_reply',
          postId,
          commentId,
          dedupeKey: `comment-reply:${commentId}`,
        })
        await social.enqueue({
          id: randomUUID(),
          aggregateType: 'comment',
          aggregateId: commentId,
          eventType: 'comment.replied',
          schemaVersion: 1,
          occurredAt: occurredAt(),
          payload: { eventType: 'comment.replied', actorId, targetId: replyRecipientId, postId, commentId, parentCommentId: normalizedParentId },
        })
      }
      if (
        social
        && normalizedParentId
        && directReplyRecipientId
        && directReplyRecipientId !== actorId
        && directReplyRecipientId !== replyRecipientId
      ) {
        await social.upsertNotification({
          recipientId: directReplyRecipientId,
          actorId,
          type: 'comment_reply',
          postId,
          commentId,
          dedupeKey: `comment-reply:${commentId}`,
        })
        await social.enqueue({
          id: randomUUID(),
          aggregateType: 'comment',
          aggregateId: commentId,
          eventType: 'comment.replied',
          schemaVersion: 1,
          occurredAt: occurredAt(),
          payload: { eventType: 'comment.replied', actorId, targetId: directReplyRecipientId, postId, commentId, parentCommentId: normalizedParentId },
        })
      }
      if (social && !normalizedParentId && post.authorId !== actorId) {
        await social.upsertNotification({
          recipientId: post.authorId,
          actorId,
          type: 'post_comment',
          postId,
          commentId,
          dedupeKey: `post-comment:${commentId}`,
        })
        await social.enqueue({
          id: randomUUID(),
          aggregateType: 'post',
          aggregateId: postId,
          eventType: 'post.commented',
          schemaVersion: 1,
          occurredAt: occurredAt(),
          payload: { eventType: 'post.commented', actorId, targetId: post.authorId, postId, commentId },
        })
      }

      await notifyCommentMentions(social, actorId, postId, commentId, mentions)
      await enqueueFeedInvalidation(social, 'feed.post_comments_changed', actorId, postId)
      return commentId
    })
  }

  async function updateComment(
    actorId: string,
    commentId: string,
    body: string,
    mentionProfileIds: string[] = [],
  ) {
    return input.withTransaction(async (repository, social) => {
      await assertOwnedComment(repository, actorId, commentId)
      const updated = await repository.updateOwnCommentWithinEditWindow(actorId, commentId, body.trim())
      if (!updated) serviceError('feed_comment_edit_expired')
      const mentions = await repository.replaceCommentMentions(actorId, commentId, mentionProfileIds)
      await notifyCommentMentions(social, actorId, updated.postId, commentId, mentions.newlyIntroducedProfileIds)
      return updated
    })
  }

  async function deleteComment(actorId: string, commentId: string) {
    return input.withTransaction(async (repository) => {
      await assertOwnedComment(repository, actorId, commentId)
      const deleted = await repository.softDeleteOwnComment(actorId, commentId)
      if (!deleted) serviceError('feed_interaction_unavailable')
      return deleted
    })
  }

  async function setCommentReaction(actorId: string, commentId: string, reaction: PostReactionType | null) {
    return input.withTransaction(async (repository, social) => {
      const comment = await repository.getCommentForInteraction(actorId, commentId)
      if (!comment) serviceError('feed_interaction_unavailable')
      await repository.setCommentReaction(actorId, commentId, reaction)
      if (!social || comment.authorId === actorId) return true
      const dedupeKey = `comment-reaction:${commentId}:${actorId}`
      if (!reaction) {
        await social.deleteNotification(comment.authorId, dedupeKey)
        return true
      }
      await social.upsertNotification({
        recipientId: comment.authorId,
        actorId,
        type: 'comment_reaction',
        postId: comment.postId,
        commentId,
        reactionType: reaction,
        dedupeKey,
      })
      await social.enqueue({
        id: randomUUID(),
        aggregateType: 'comment',
        aggregateId: commentId,
        eventType: 'comment.reacted',
        schemaVersion: 1,
        occurredAt: occurredAt(),
        payload: {
          eventType: 'comment.reacted',
          actorId,
          targetId: comment.authorId,
          postId: comment.postId,
          commentId,
          reactionType: reaction,
        },
      })
      return true
    })
  }

  async function setPollVote(actorId: string, postId: string, optionId: string) {
    return input.withTransaction(async (repository) => {
      const post = await assertInteractablePost(repository, actorId, postId)
      if (post.postType !== 'poll') serviceError('feed_poll_option_unavailable')
      if (!await repository.pollOptionBelongsToPost(postId, optionId)) serviceError('feed_poll_option_unavailable')
      await repository.setPollVote(actorId, postId, optionId)
      return true
    })
  }

  return {
    createStandardPost,
    assertPendingMediaDiscardable,
    createPollPost,
    repostPost,
    deletePost,
    updatePost,
    restoreDeletedPost,
    getReactionDetails,
    setPostReaction,
    setLiked,
    setSaved,
    setHidden,
    unhidePost,
    addComment,
    updateComment,
    deleteComment,
    setCommentReaction,
    setPollVote,
  }
}

const productionService = createFeedService({
  withTransaction: (fn) => databaseTransaction((client) => fn(
    createFeedRepositoryForClient(client),
    createFeedSocialWriterForClient(client),
  )),
})

export const createStandardPostWithAurora = productionService.createStandardPost
export const assertPendingMediaDiscardableWithAurora = productionService.assertPendingMediaDiscardable
export const createPollPostWithAurora = productionService.createPollPost
export const repostPostWithAurora = productionService.repostPost
export const deletePostWithAurora = productionService.deletePost
export const updatePostWithAurora = productionService.updatePost
export const restoreDeletedPostWithAurora = productionService.restoreDeletedPost
export const loadReactionDetailsWithAurora = productionService.getReactionDetails
export const setPostReactionWithAurora = productionService.setPostReaction
export const setPostLikedWithAurora = productionService.setLiked
export const setPostSavedWithAurora = productionService.setSaved
export const setPostHiddenWithAurora = productionService.setHidden
export const unhidePostWithAurora = productionService.unhidePost
export const addPostCommentWithAurora = productionService.addComment
export const updateCommentWithAurora = productionService.updateComment
export const deleteCommentWithAurora = productionService.deleteComment
export const setCommentReactionWithAurora = productionService.setCommentReaction
export const setPollVoteWithAurora = productionService.setPollVote
