import { randomUUID } from 'node:crypto'
import { withTransaction as databaseTransaction } from '@/lib/db/client'
import { resolveFeedMediaUrls } from './media'
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
  media?: FeedMediaInput
  mentionProfileIds?: string[]
}

type PollPostInput = Omit<StandardPostInput, 'id' | 'media'> & {
  pollOptions: string[]
}

type ReactionDetailsRequest = {
  targetType: ReactionTargetType
  targetId: string
  reaction?: PostReactionType
  cursor?: string
  limit: number
}

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
}) {
  const createId = input.createId ?? randomUUID
  const resolveMediaUrls = input.resolveMediaUrls ?? resolveFeedMediaUrls

  async function createStandardPost(actorId: string, post: StandardPostInput) {
    return input.withTransaction(async (repository, social) => {
      await assertMemberReady(repository, actorId)
      const id = post.id ?? createId()
      await repository.insertStandardPost({ id, authorId: actorId, category: post.category, body: post.body.trim() })
      if (post.media) await repository.insertPostMedia(id, post.media)
      const mentions = post.mentionProfileIds?.length
        ? await repository.insertPostMentions(actorId, id, post.mentionProfileIds)
        : []
      await notifyPostMentions(social, actorId, id, mentions)
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
      const options = normalizePollOptions(post.pollOptions)
      const id = createId()
      await repository.insertPollPost({ id, authorId: actorId, category: post.category, body: post.body.trim() })
      for (const [position, label] of options.entries()) await repository.insertPollOption(id, label, position)
      const mentions = post.mentionProfileIds?.length
        ? await repository.insertPostMentions(actorId, id, post.mentionProfileIds)
        : []
      await notifyPostMentions(social, actorId, id, mentions)
      return id
    })
  }

  async function deletePost(actorId: string, postId: string) {
    return input.withTransaction(async (repository) => {
      await assertMemberReady(repository, actorId)
      if (!await repository.deleteOwnPost(actorId, postId)) serviceError('feed_post_delete_forbidden')
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
    return input.withTransaction(async (repository) => {
      await assertInteractablePost(repository, actorId, postId)
      await repository.setLiked(actorId, postId, liked)
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
      if (parentCommentId) {
        const parent = await repository.getCommentForInteraction(actorId, parentCommentId)
        if (!parent || parent.postId !== postId) serviceError('feed_comment_parent_unavailable')
        normalizedParentId = parent.rootParentId
        const root = parent.rootParentId === parent.id
          ? parent
          : await repository.getCommentForInteraction(actorId, parent.rootParentId)
        if (!root || root.postId !== postId) serviceError('feed_comment_parent_unavailable')
        replyRecipientId = root.authorId
      }
      const commentId = await repository.addComment(actorId, postId, body.trim(), normalizedParentId)
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
      } else if (social && !normalizedParentId && post.authorId !== actorId) {
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
      return commentId
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
    deletePost,
    getReactionDetails,
    setPostReaction,
    setLiked,
    setSaved,
    addComment,
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
export const deletePostWithAurora = productionService.deletePost
export const loadReactionDetailsWithAurora = productionService.getReactionDetails
export const setPostReactionWithAurora = productionService.setPostReaction
export const setPostLikedWithAurora = productionService.setLiked
export const setPostSavedWithAurora = productionService.setSaved
export const addPostCommentWithAurora = productionService.addComment
export const setCommentReactionWithAurora = productionService.setCommentReaction
export const setPollVoteWithAurora = productionService.setPollVote
