import { randomUUID } from 'node:crypto'
import { withTransaction as databaseTransaction } from '@/lib/db/client'
import {
  createFeedRepositoryForClient,
  type FeedRepository,
} from './repository'
import type { PostCategory } from './types'

type FeedTransaction = <T>(fn: (repository: FeedRepository) => Promise<T>) => Promise<T>

type StandardPostInput = {
  category: PostCategory
  body: string
}

type PollPostInput = StandardPostInput & {
  pollOptions: string[]
}

function serviceError(code: string): never {
  throw new Error(code)
}

async function assertMemberReady(repository: FeedRepository, profileId: string) {
  if (!await repository.isMemberReady(profileId)) {
    serviceError('feed_interaction_unavailable')
  }
}

async function assertInteractablePost(
  repository: FeedRepository,
  viewerProfileId: string,
  postId: string,
) {
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

  if (normalized.length < 2 || normalized.length > 6) {
    serviceError('feed_poll_options_invalid')
  }
  return normalized
}

export function createFeedService(input: {
  withTransaction: FeedTransaction
  createId?: () => string
}) {
  const createId = input.createId ?? randomUUID

  async function createStandardPost(actorId: string, post: StandardPostInput) {
    return input.withTransaction(async (repository) => {
      await assertMemberReady(repository, actorId)
      const id = createId()
      await repository.insertStandardPost({
        id,
        authorId: actorId,
        category: post.category,
        body: post.body.trim(),
      })
      return id
    })
  }

  async function createPollPost(actorId: string, post: PollPostInput) {
    return input.withTransaction(async (repository) => {
      await assertMemberReady(repository, actorId)
      const options = normalizePollOptions(post.pollOptions)
      const id = createId()
      await repository.insertPollPost({
        id,
        authorId: actorId,
        category: post.category,
        body: post.body.trim(),
      })
      for (const [position, label] of options.entries()) {
        await repository.insertPollOption(id, label, position)
      }
      return id
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

  async function addComment(actorId: string, postId: string, body: string) {
    return input.withTransaction(async (repository) => {
      await assertInteractablePost(repository, actorId, postId)
      await repository.addComment(actorId, postId, body.trim())
      return true
    })
  }

  async function setPollVote(actorId: string, postId: string, optionId: string) {
    return input.withTransaction(async (repository) => {
      const post = await assertInteractablePost(repository, actorId, postId)
      if (post.postType !== 'poll') serviceError('feed_poll_option_unavailable')
      if (!await repository.pollOptionBelongsToPost(postId, optionId)) {
        serviceError('feed_poll_option_unavailable')
      }
      await repository.setPollVote(actorId, postId, optionId)
      return true
    })
  }

  return {
    createStandardPost,
    createPollPost,
    setLiked,
    setSaved,
    addComment,
    setPollVote,
  }
}

const productionService = createFeedService({
  withTransaction: (fn) => databaseTransaction((client) => fn(createFeedRepositoryForClient(client))),
})

export const createStandardPostWithAurora = productionService.createStandardPost
export const createPollPostWithAurora = productionService.createPollPost
export const setPostLikedWithAurora = productionService.setLiked
export const setPostSavedWithAurora = productionService.setSaved
export const addPostCommentWithAurora = productionService.addComment
export const setPollVoteWithAurora = productionService.setPollVote
