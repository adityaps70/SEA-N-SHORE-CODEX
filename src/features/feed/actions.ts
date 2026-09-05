'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { removeFeedImage, uploadFeedImage } from './media'
import { getFeedPage } from './queries'
import { commentInputSchema, createPostInputSchema, feedRequestSchema, pollVoteSchema } from './schemas'
import {
  addPostCommentWithAurora,
  createPollPostWithAurora,
  createStandardPostWithAurora,
  setPollVoteWithAurora,
  setPostLikedWithAurora,
  setPostSavedWithAurora,
} from './service'
import { POST_CATEGORIES, type FeedRequest, type PostCategory } from './types'

export type FeedActionResult = { ok: true } | { ok: false; error: string }

export type PostComposerState = {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string[]>
  values?: {
    category?: PostCategory
    body?: string
    mode?: 'standard' | 'poll'
    pollOptions?: string[]
  }
}

export type CommentActionState = {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string[]>
  value?: string
}

const extensionByMime = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

type AllowedImageMime = keyof typeof extensionByMime

function isAllowedImageMime(value: string): value is AllowedImageMime {
  return value in extensionByMime
}

function postInputFromFormData(formData: FormData) {
  const mode: 'standard' | 'poll' = formData.get('mode') === 'poll' ? 'poll' : 'standard'
  return {
    category: formData.get('category'),
    body: formData.get('body'),
    mode,
    pollOptions: formData.getAll('pollOption'),
  }
}

function safePostValues(formData: FormData): PostComposerState['values'] {
  const raw = postInputFromFormData(formData)
  const category = typeof raw.category === 'string' ? raw.category : undefined
  return {
    category: POST_CATEGORIES.includes(category as PostCategory) ? category as PostCategory : undefined,
    body: typeof raw.body === 'string' && raw.body.length <= 5000 ? raw.body : undefined,
    mode: raw.mode,
    pollOptions: raw.pollOptions.flatMap((value) => typeof value === 'string' && value.length <= 120 ? [value] : []),
  }
}

function mediaInput(formData: FormData, mode: 'standard' | 'poll') {
  const candidate = formData.get('media')
  const media = candidate instanceof File && candidate.size > 0 ? candidate : null
  const altValue = formData.get('altText')
  const altText = typeof altValue === 'string' ? altValue.trim() : ''

  if (media && mode === 'poll') return { error: 'Technical polls cannot include an image in this release.' } as const
  if (altText.length > 300) return { error: 'Keep the image description to 300 characters or fewer.' } as const
  if (!media) return { media: null, altText: altText || null, extension: null } as const
  if (media.size > 5 * 1024 * 1024) return { error: 'Images must be 5 MiB or smaller.' } as const
  if (!isAllowedImageMime(media.type)) return { error: 'Use a JPEG, PNG, or WebP image.' } as const
  return { media, altText: altText || null, extension: extensionByMime[media.type] } as const
}

export async function createPost(
  _previousState: PostComposerState,
  formData: FormData,
): Promise<PostComposerState> {
  const raw = postInputFromFormData(formData)
  const parsed = createPostInputSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      values: safePostValues(formData),
    }
  }

  const media = mediaInput(formData, parsed.data.mode)
  if ('error' in media && typeof media.error === 'string') {
    return { fieldErrors: { media: [media.error] }, values: safePostValues(formData) }
  }

  const user = await requireAwsUser()
  const data = parsed.data

  if (data.mode === 'poll') {
    try {
      await createPollPostWithAurora(user.id, {
        category: data.category,
        body: data.body,
        pollOptions: data.pollOptions,
      })
    } catch {
      return { error: 'We could not publish your poll. Your entries are still here.', values: safePostValues(formData) }
    }
  } else if (media.media && media.extension) {
    const postId = crypto.randomUUID()
    let storagePath: string
    try {
      storagePath = await uploadFeedImage({
        profileId: user.id,
        postId,
        file: media.media,
        extension: media.extension,
      })
    } catch {
      return { error: 'We could not upload your image. Your post was not published.', values: safePostValues(formData) }
    }

    try {
      await createStandardPostWithAurora(user.id, {
        id: postId,
        category: data.category,
        body: data.body,
        media: {
          storagePath,
          mimeType: media.media.type,
          altText: media.altText,
        },
      })
    } catch {
      await removeFeedImage(storagePath)
      return { error: 'We could not attach your image, so the post was not published.', values: safePostValues(formData) }
    }
  } else {
    try {
      await createStandardPostWithAurora(user.id, {
        category: data.category,
        body: data.body,
      })
    } catch {
      return { error: 'We could not publish your post. Your entries are still here.', values: safePostValues(formData) }
    }
  }

  revalidatePath('/home')
  return { ok: true }
}

export async function loadFeedPage(input: FeedRequest) {
  const parsed = feedRequestSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: 'The next feed page request was invalid.' }
  try {
    const page = await getFeedPage(parsed.data)
    return { ok: true as const, page }
  } catch {
    return { ok: false as const, error: 'We could not load more posts.' }
  }
}

const postIdSchema = z.string().uuid()

export async function setPostLiked(postId: string, liked: boolean): Promise<FeedActionResult> {
  const parsedId = postIdSchema.safeParse(postId)
  if (!parsedId.success || typeof liked !== 'boolean') return { ok: false, error: 'Invalid post.' }
  const user = await requireAwsUser()
  try {
    await setPostLikedWithAurora(user.id, parsedId.data, liked)
  } catch {
    return { ok: false, error: 'We could not update your like.' }
  }
  revalidatePath('/home')
  return { ok: true }
}

export async function setPostSaved(postId: string, saved: boolean): Promise<FeedActionResult> {
  const parsedId = postIdSchema.safeParse(postId)
  if (!parsedId.success || typeof saved !== 'boolean') return { ok: false, error: 'Invalid post.' }
  const user = await requireAwsUser()
  try {
    await setPostSavedWithAurora(user.id, parsedId.data, saved)
  } catch {
    return { ok: false, error: 'We could not update your saved posts.' }
  }
  revalidatePath('/home')
  return { ok: true }
}

export async function addComment(
  _previousState: CommentActionState,
  formData: FormData,
): Promise<CommentActionState> {
  const raw = { postId: formData.get('postId'), body: formData.get('body') }
  const parsed = commentInputSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      value: typeof raw.body === 'string' && raw.body.length <= 2000 ? raw.body : undefined,
    }
  }

  const user = await requireAwsUser()
  try {
    await addPostCommentWithAurora(user.id, parsed.data.postId, parsed.data.body)
  } catch {
    return { error: 'We could not add your comment.', value: parsed.data.body }
  }
  revalidatePath('/home')
  return { ok: true }
}

export async function setPollVote(postId: string, optionId: string): Promise<FeedActionResult> {
  const parsed = pollVoteSchema.safeParse({ postId, optionId })
  if (!parsed.success) return { ok: false, error: 'Invalid poll option.' }
  const user = await requireAwsUser()
  try {
    await setPollVoteWithAurora(user.id, parsed.data.postId, parsed.data.optionId)
  } catch {
    return { ok: false, error: 'We could not record your vote.' }
  }
  revalidatePath('/home')
  return { ok: true }
}
