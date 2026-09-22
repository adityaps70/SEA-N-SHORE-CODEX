import { z } from 'zod'
import { POST_DOCUMENT_MAX_PAGES, POST_IMAGE_MAX_COUNT } from './media-policy'
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
const commentBodySchema = z.string().trim().min(1, 'Write a comment first.').max(2000, 'Keep comments to 2,000 characters or fewer.')
const mentionIdsSchema = z.preprocess(normalizeMentionIds, z.array(z.string().uuid()).max(20, 'Mention no more than 20 members.')).default([])
const pollOptionsSchema = z.preprocess(
  normalizePollOptions,
  z.array(z.string().max(120, 'Keep each poll option to 120 characters or fewer.')).min(2, 'Add at least two distinct poll options.').max(6, 'Add no more than six poll options.'),
)

export const reactionSchema = z.enum(POST_REACTIONS)

export const reactionDetailsSchema = z.object({
  targetType: z.enum(['post', 'comment']),
  targetId: z.string().uuid(),
  reaction: reactionSchema.optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(50).default(30),
})

export const postMediaReferenceSchema = z.object({
  postId: z.string().uuid(),
  storagePath: z.string().min(1).max(500),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'application/pdf']),
  size: z.coerce.number().int().positive(),
  altText: z.string().trim().max(300).optional().default(''),
  position: z.coerce.number().int().min(0).max(POST_IMAGE_MAX_COUNT - 1),
  fileName: z.string().trim().min(1).max(255),
  pageCount: z.preprocess(
    (value) => value === '' || value == null ? null : Number(value),
    z.number().int().min(1).max(POST_DOCUMENT_MAX_PAGES, `PDF documents can have no more than ${POST_DOCUMENT_MAX_PAGES} pages.`).nullable(),
  ).default(null),
}).superRefine((media, context) => {
  if (media.mimeType === 'application/pdf' && media.pageCount === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pageCount'],
      message: 'PDF page count is required.',
    })
  }
  if (media.mimeType !== 'application/pdf' && media.pageCount !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pageCount'],
      message: 'Only PDF documents can include a page count.',
    })
  }
})

const postMediaCollectionSchema = z.array(postMediaReferenceSchema)
  .max(POST_IMAGE_MAX_COUNT, `Add no more than ${POST_IMAGE_MAX_COUNT} photos.`)
  .superRefine((media, context) => {
    if (!media.length) return
    const postIds = new Set(media.map((item) => item.postId))
    if (postIds.size !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'All media in a post must share one upload session.',
      })
    }

    const positions = media.map((item) => item.position)
    if (new Set(positions).size !== positions.length || positions.some((position) => position < 0 || position >= media.length)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Media positions must be unique and contiguous.',
      })
    }

    const imageCount = media.filter((item) => item.mimeType.startsWith('image/')).length
    if (media.length > 1 && imageCount !== media.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose up to 20 images, or attach one video or one PDF document.',
      })
    }
  })
  .transform((media) => [...media].sort((a, b) => a.position - b.position))

const standardPostSchema = z.object({
  category: z.enum(POST_CATEGORIES),
  body: bodySchema,
  mode: z.literal('standard'),
  pollOptions: z.preprocess(() => [], z.array(z.never()).max(0)).optional().default([]),
  media: postMediaCollectionSchema.optional(),
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
  body: commentBodySchema,
  parentCommentId: z.preprocess((value) => value === '' || value == null ? undefined : value, z.string().uuid().optional()),
  mentionProfileIds: mentionIdsSchema,
})

export const updateCommentInputSchema = z.object({
  commentId: z.string().uuid(),
  body: commentBodySchema,
  mentionProfileIds: mentionIdsSchema,
})

export const deleteCommentInputSchema = z.object({
  commentId: z.string().uuid(),
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
export type UpdateCommentInput = z.infer<typeof updateCommentInputSchema>
export type DeleteCommentInput = z.infer<typeof deleteCommentInputSchema>
export type FeedRequestInput = z.infer<typeof feedRequestSchema>
export type ReactionDetailsInput = z.infer<typeof reactionDetailsSchema>
