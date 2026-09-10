import { z } from 'zod'
import { POST_CATEGORIES, POST_REACTIONS } from './types'

const normalizePollOptions = (value: unknown) => {
  const source = Array.isArray(value) ? value : []
  const seen = new Set<string>()
  return source.flatMap((entry) => {
    if (typeof entry !== 'string') return []
    const option = entry.trim()
    if (!option) return []
    const key = option.toLocaleLowerCase('en')
    if (seen.has(key)) return []
    seen.add(key)
    return [option]
  })
}

const normalizeMentionIds = (value: unknown) => {
  const source = Array.isArray(value) ? value : value == null ? [] : [value]
  return [...new Set(source.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0))]
}

const bodySchema = z.string().trim().min(1, 'Write something before posting.').max(5000, 'Keep posts to 5,000 characters or fewer.')
const mentionIdsSchema = z.preprocess(normalizeMentionIds, z.array(z.string().uuid()).max(20, 'Mention no more than 20 members.')).default([])
const pollOptionsSchema = z.preprocess(
  normalizePollOptions,
  z.array(z.string().max(120, 'Keep each poll option to 120 characters or fewer.')).min(2, 'Add at least two distinct poll options.').max(6, 'Add no more than six poll options.'),
)

export const reactionSchema = z.enum(POST_REACTIONS)

export const postMediaReferenceSchema = z.object({
  postId: z.string().uuid(),
  storagePath: z.string().min(1).max(500),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']),
  size: z.coerce.number().int().positive(),
  altText: z.string().trim().max(300).optional().default(''),
})

const standardPostSchema = z.object({
  category: z.enum(POST_CATEGORIES),
  body: bodySchema,
  mode: z.literal('standard'),
  pollOptions: z.preprocess(() => [], z.array(z.never()).max(0)).optional().default([]),
  media: postMediaReferenceSchema.optional(),
  mentionProfileIds: mentionIdsSchema,
})

const pollPostSchema = z.object({
  category: z.enum(POST_CATEGORIES),
  body: bodySchema,
  mode: z.literal('poll'),
  pollOptions: pollOptionsSchema,
  media: z.never({ error: 'Technical polls cannot include media.' }).optional(),
  mentionProfileIds: mentionIdsSchema,
})

export const createPostInputSchema = z.discriminatedUnion('mode', [standardPostSchema, pollPostSchema])

export const commentInputSchema = z.object({
  postId: z.string().uuid(),
  body: z.string().trim().min(1, 'Write a comment first.').max(2000, 'Keep comments to 2,000 characters or fewer.'),
  parentCommentId: z.preprocess((value) => value === '' || value == null ? undefined : value, z.string().uuid().optional()),
  mentionProfileIds: mentionIdsSchema,
})

export const feedCursorSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
})

export const feedRequestSchema = z.object({
  category: z.enum(POST_CATEGORIES).optional(),
  cursor: feedCursorSchema.optional(),
  limit: z.number().int().min(1).max(20).default(12),
})

export const pollVoteSchema = z.object({
  postId: z.string().uuid(),
  optionId: z.string().uuid(),
})

export function parseFeedCategory(value: unknown) {
  const parsed = z.enum(POST_CATEGORIES).safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export type PostMediaReferenceInput = z.infer<typeof postMediaReferenceSchema>
export type CreatePostInput = z.infer<typeof createPostInputSchema>
export type CommentInput = z.infer<typeof commentInputSchema>
export type FeedRequestInput = z.infer<typeof feedRequestSchema>
