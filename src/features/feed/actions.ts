'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  createPendingPostMediaUpload,
  removeFeedImage,
  verifyPendingPostMedia,
} from './media'
import { validatePostMediaMetadata } from './media-policy'
import { getFeedPage } from './queries'
import { commentInputSchema, createPostInputSchema, feedRequestSchema, pollVoteSchema } from './schemas'
import {
  addPostCommentWithAurora,
  createPollPostWithAurora,
  createStandardPostWithAurora,
  deletePostWithAurora,
  setPollVoteWithAurora,
  setPostLikedWithAurora,
  setPostSavedWithAurora,
} from './service'
import { POST_CATEGORIES, type FeedRequest, type PostCategory } from './types'

export type FeedActionResult = { ok: true } | { ok: false; error: string }

export type PostMediaUploadActionResult =
  | { ok: true; upload: Awaited<ReturnType<typeof createPendingPostMediaUpload>> }
  | { ok: false; error: string }

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

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return /^[a-z][a-z0-9_]{0,79}$/.test(message) ? message : 'unknown_error'
}

function postMediaReferenceFromFormData(formData: FormData) {
  const postId = formData.get('mediaPostId')
  const storagePath = formData.get('mediaStoragePath')
  const mimeType = formData.get('mediaMimeType')
  const size = formData.get('mediaSize')
  const altText = formData.get('altText')
  const hasReference = [postId, storagePath, mimeType, size].some((value) => (
    typeof value === 'string' && value.trim().length > 0
  ))

  if (!hasReference) return undefined
  return { postId, storagePath, mimeType, size, altText }
}

function postInputFromFormData(formData: FormData) {
  const mode: 'standard' | 'poll' = formData.get('mode') === 'poll' ? 'poll' : 'standard'
  return {
    category: formData.get('category'),
    body: formData.get('body'),
    mode,
    pollOptions: formData.getAll('pollOption'),
    media: postMediaReferenceFromFormData(formData),
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

export async function createPostMediaUpload(input: {
  mimeType: string
  size: number
}): Promise<PostMediaUploadActionResult> {
  const metadata = validatePostMediaMetadata(input)
  if (!metadata.ok) return { ok: false, error: metadata.error }

  const user = await requireAwsUser()
  try {
    const upload = await createPendingPostMediaUpload({
      profileId: user.id,
      mimeType: metadata.mimeType,
      size: input.size,
    })
    return { ok: true, upload }
  } catch (error) {
    console.error('[feed_media_presign_failed]', { errorCode: safeErrorCode(error) })
    return { ok: false, error: 'We could not prepare your media upload. Please try again.' }
  }
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

  const user = await requireAwsUser()
  const data = parsed.data

  if (data.mode === 'poll') {
    try {
      const postId = await createPollPostWithAurora(user.id, {
        category: data.category,
        body: data.body,
        pollOptions: data.pollOptions,
      })
      console.info('[feed_publish_success]', { postId, hasMedia: false })
    } catch (error) {
      console.error('[feed_publish_failed]', {
        stage: 'aurora_create',
        hasMedia: false,
        errorCode: safeErrorCode(error),
      })
      return { error: 'We could not publish your poll. Your entries are still here.', values: safePostValues(formData) }
    }
  } else if (data.media) {
    const postId = data.media.postId
    try {
      await verifyPendingPostMedia({
        profileId: user.id,
        postId,
        storagePath: data.media.storagePath,
        mimeType: data.media.mimeType,
        size: data.media.size,
      })
    } catch (error) {
      console.error('[feed_publish_failed]', {
        stage: 'media_verify',
        postId,
        hasMedia: true,
        errorCode: safeErrorCode(error),
      })
      return { error: 'We could not verify your uploaded media. Please upload it again.', values: safePostValues(formData) }
    }

    try {
      await createStandardPostWithAurora(user.id, {
        id: postId,
        category: data.category,
        body: data.body,
        media: {
          storagePath: data.media.storagePath,
          mimeType: data.media.mimeType,
          altText: data.media.altText || null,
        },
      })
      console.info('[feed_publish_success]', { postId, hasMedia: true })
    } catch (error) {
      console.error('[feed_publish_failed]', {
        stage: 'aurora_create',
        postId,
        hasMedia: true,
        errorCode: safeErrorCode(error),
      })
      try {
        await removeFeedImage(data.media.storagePath)
      } catch {
        // Cleanup is compensating and must not mask the original post-publication failure.
      }
      return { error: 'We could not attach your media, so the post was not published.', values: safePostValues(formData) }
    }
  } else {
    try {
      const postId = await createStandardPostWithAurora(user.id, {
        category: data.category,
        body: data.body,
      })
      console.info('[feed_publish_success]', { postId, hasMedia: false })
    } catch (error) {
      console.error('[feed_publish_failed]', {
        stage: 'aurora_create',
        hasMedia: false,
        errorCode: safeErrorCode(error),
      })
      return { error: 'We could not publish your post. Your entries are still here.', values: safePostValues(formData) }
    }
  }

  revalidatePath('/home')
  revalidatePath('/profile')
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

export async function deletePost(postId: string): Promise<FeedActionResult> {
  const parsedId = postIdSchema.safeParse(postId)
  if (!parsedId.success) return { ok: false, error: 'Invalid post.' }
  const user = await requireAwsUser()
  try {
    await deletePostWithAurora(user.id, parsedId.data)
  } catch {
    return { ok: false, error: 'We could not delete this post.' }
  }
  revalidatePath('/home')
  revalidatePath('/saved')
  revalidatePath('/profile')
  revalidatePath('/people/[slug]', 'page')
  revalidatePath('/posts/[id]', 'page')
  return { ok: true }
}

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
  revalidatePath('/saved')
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
