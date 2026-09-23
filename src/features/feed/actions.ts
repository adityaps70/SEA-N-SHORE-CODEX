'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { assessPlatformText, automatedModerationDetails, moderationBlockMessage, type AutomatedModerationAssessment } from '@/features/moderation/automated'
import { moderationRepository } from '@/features/moderation/repository'
import {
  createPendingPostMediaUpload,
  removeFeedImage,
  verifyPendingPostMedia,
} from './media'
import {
  POST_DOCUMENT_MAX_PAGES,
  POST_IMAGE_MAX_COUNT,
  isOwnedPostMediaStoragePath,
  validatePostMediaMetadata,
} from './media-policy'
import { getFeedPage, getPostById } from './queries'
import {
  commentInputSchema,
  createPostInputSchema,
  deleteCommentInputSchema,
  feedRequestSchema,
  pollVoteSchema,
  reactionDetailsSchema,
  reactionSchema,
  updateCommentInputSchema,
} from './schemas'
import {
  addPostCommentWithAurora,
  assertPendingMediaDiscardableWithAurora,
  createPollPostWithAurora,
  createStandardPostWithAurora,
  deleteCommentWithAurora,
  deletePostWithAurora,
  restoreDeletedPostWithAurora,
  loadReactionDetailsWithAurora,
  repostPostWithAurora,
  setCommentReactionWithAurora,
  setPollVoteWithAurora,
  setPostLikedWithAurora,
  setPostReactionWithAurora,
  setPostSavedWithAurora,
  updateCommentWithAurora,
} from './service'
import { POST_CATEGORIES, type FeedComment, type FeedRequest, type PostCategory, type PostReactionType } from './types'

export type FeedActionResult = { ok: true } | { ok: false; error: string }
export type RepostActionResult = { ok: true; postId: string } | { ok: false; error: string }

export type PostMediaUploadActionResult =
  | { ok: true; upload: Awaited<ReturnType<typeof createPendingPostMediaUpload>> }
  | { ok: false; error: string }

export type PostMediaUploadsActionResult =
  | { ok: true; uploads: Awaited<ReturnType<typeof createPendingPostMediaUpload>>[] }
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
  comment?: FeedComment
}

export type DeleteCommentActionResult =
  | { ok: true; commentId: string; comment: FeedComment | null }
  | { ok: false; error: string }

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return /^[a-z][a-z0-9_]{0,79}$/.test(message) ? message : 'unknown_error'
}

function postMediaReferencesFromFormData(formData: FormData) {
  const manifest = formData.get('mediaManifest')
  if (typeof manifest === 'string' && manifest.trim()) {
    try {
      const parsed = JSON.parse(manifest)
      return Array.isArray(parsed) ? parsed : parsed ? [parsed] : undefined
    } catch {
      return [{ invalidManifest: true }]
    }
  }

  const postId = formData.get('mediaPostId')
  const storagePath = formData.get('mediaStoragePath')
  const mimeType = formData.get('mediaMimeType')
  const size = formData.get('mediaSize')
  const altText = formData.get('altText')
  const hasReference = [postId, storagePath, mimeType, size].some((value) => (
    typeof value === 'string' && value.trim().length > 0
  ))
  if (!hasReference) return undefined
  const fileName = typeof storagePath === 'string' ? storagePath.split('/').at(-1) ?? 'media' : 'media'
  return [{ postId, storagePath, mimeType, size, altText, position: 0, fileName, pageCount: null }]
}

function mentionIds(formData: FormData) {
  return formData.getAll('mentionProfileId')
}

function postInputFromFormData(formData: FormData) {
  const mode: 'standard' | 'poll' = formData.get('mode') === 'poll' ? 'poll' : 'standard'
  return {
    category: formData.get('category') ?? 'technical_discussion',
    body: formData.get('body'),
    mode,
    pollOptions: formData.getAll('pollOption'),
    media: postMediaReferencesFromFormData(formData),
    mentionProfileIds: mentionIds(formData),
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

async function flagAutomatedModeration(
  targetType: 'post' | 'comment',
  targetId: string,
  assessment: AutomatedModerationAssessment,
) {
  if (assessment.decision !== 'review' || !assessment.reason) return
  const details = automatedModerationDetails(assessment)
  if (!details) return
  try {
    await moderationRepository.flagContentAutomatically({
      targetType,
      targetId,
      reason: assessment.reason,
      details,
    })
  } catch (error) {
    console.error('[automated_moderation_flag_failed]', {
      targetType,
      targetId,
      errorCode: safeErrorCode(error),
    })
  }
}

function revalidateSocialFeed() {
  revalidatePath('/home')
  revalidatePath('/activities')
  revalidatePath('/profile')
  revalidatePath('/people/[slug]', 'page')
  revalidatePath('/posts/[id]', 'page')
}

async function hydrateComment(postId: string, commentId: string) {
  const post = await getPostById(postId)
  return post?.comments.find((comment) => comment.id === commentId) ?? null
}

const postMediaUploadBatchSchema = z.object({
  postId: z.string().uuid().optional(),
  files: z.array(z.object({
    mimeType: z.string().min(1).max(100),
    size: z.number().int().positive(),
    fileName: z.string().trim().min(1).max(255),
    pageCount: z.number().int().min(1).max(POST_DOCUMENT_MAX_PAGES).nullable().optional(),
  })).min(1).max(POST_IMAGE_MAX_COUNT),
})

export async function createPostMediaUploads(input: {
  postId?: string
  files: Array<{ mimeType: string; size: number; fileName: string; pageCount?: number | null }>
}): Promise<PostMediaUploadsActionResult> {
  const parsed = postMediaUploadBatchSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: `Choose up to ${POST_IMAGE_MAX_COUNT} supported media files.` }

  const validated = parsed.data.files.map((file) => ({
    file,
    metadata: validatePostMediaMetadata({ mimeType: file.mimeType, size: file.size }),
  }))
  const invalid = validated.find((entry) => !entry.metadata.ok)
  if (invalid && !invalid.metadata.ok) return { ok: false, error: invalid.metadata.error }

  if (parsed.data.files.length > 1 && parsed.data.files.some((file) => !file.mimeType.startsWith('image/'))) {
    return { ok: false, error: `Choose up to ${POST_IMAGE_MAX_COUNT} photos, or attach one video or one PDF document.` }
  }

  const pdf = parsed.data.files.find((file) => file.mimeType === 'application/pdf')
  if (pdf && (pdf.pageCount == null || pdf.pageCount < 1 || pdf.pageCount > POST_DOCUMENT_MAX_PAGES)) {
    return { ok: false, error: `PDF documents can have no more than ${POST_DOCUMENT_MAX_PAGES} pages.` }
  }

  const user = await requireAwsUser()
  const postId = parsed.data.postId ?? crypto.randomUUID()
  try {
    const uploads = await Promise.all(validated.map(({ file, metadata }) => {
      if (!metadata.ok) throw new Error('feed_media_policy_invalid')
      return createPendingPostMediaUpload({
        profileId: user.id,
        postId,
        mimeType: metadata.mimeType,
        size: file.size,
      })
    }))
    return { ok: true, uploads }
  } catch (error) {
    console.error('[feed_media_presign_failed]', { errorCode: safeErrorCode(error) })
    return { ok: false, error: 'We could not prepare your media upload. Please try again.' }
  }
}

export async function createPostMediaUpload(input: {
  mimeType: string
  size: number
  fileName?: string
  pageCount?: number | null
}): Promise<PostMediaUploadActionResult> {
  const result = await createPostMediaUploads({
    files: [{
      mimeType: input.mimeType,
      size: input.size,
      fileName: input.fileName?.trim() || 'media',
      pageCount: input.pageCount ?? null,
    }],
  })
  if (!result.ok) return result
  const upload = result.uploads[0]
  return upload ? { ok: true, upload } : { ok: false, error: 'We could not prepare your media upload. Please try again.' }
}

const discardPendingPostMediaSchema = z.object({
  postId: z.string().uuid(),
  storagePath: z.string().min(1).max(500),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'application/pdf']),
})

export async function discardPendingPostMedia(input: { postId: string; storagePath: string; mimeType: string }): Promise<FeedActionResult> {
  const parsed = discardPendingPostMediaSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid media.' }
  const user = await requireAwsUser()
  if (!isOwnedPostMediaStoragePath({ profileId: user.id, postId: parsed.data.postId, storagePath: parsed.data.storagePath, mimeType: parsed.data.mimeType })) {
    return { ok: false, error: 'Invalid media.' }
  }
  try {
    await assertPendingMediaDiscardableWithAurora(user.id, parsed.data.storagePath)
    await removeFeedImage(parsed.data.storagePath)
    return { ok: true }
  } catch {
    return { ok: false, error: 'We could not remove this media.' }
  }
}

export async function createPost(_previousState: PostComposerState, formData: FormData): Promise<PostComposerState> {
  const parsed = createPostInputSchema.safeParse(postInputFromFormData(formData))
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>, values: safePostValues(formData) }
  }
  const data = parsed.data
  const moderation = assessPlatformText([
    data.body,
    ...(data.mode === 'poll' ? data.pollOptions : []),
    ...(data.media?.map((media) => media.altText) ?? []),
  ])
  if (moderation.decision === 'block') {
    return { error: moderationBlockMessage(), values: safePostValues(formData) }
  }

  const user = await requireAwsUser()

  if (data.mode === 'poll') {
    try {
      const postId = await createPollPostWithAurora(user.id, {
        category: data.category,
        body: data.body,
        pollOptions: data.pollOptions,
        mentionProfileIds: data.mentionProfileIds,
      })
      await flagAutomatedModeration('post', postId, moderation)
      console.info('[feed_publish_success]', { postId, hasMedia: false })
    } catch (error) {
      console.error('[feed_publish_failed]', { stage: 'aurora_create', hasMedia: false, errorCode: safeErrorCode(error) })
      return { error: 'We could not publish your poll. Your entries are still here.', values: safePostValues(formData) }
    }
  } else if (data.media?.length) {
    const postId = data.media[0]?.postId
    if (!postId) return { error: 'We could not verify your uploaded media. Please upload it again.', values: safePostValues(formData) }
    try {
      for (const media of data.media) {
        await verifyPendingPostMedia({
          profileId: user.id,
          postId,
          storagePath: media.storagePath,
          mimeType: media.mimeType,
          size: media.size,
          pageCount: media.pageCount,
        })
      }
    } catch (error) {
      console.error('[feed_publish_failed]', { stage: 'media_verify', postId, hasMedia: true, errorCode: safeErrorCode(error) })
      return { error: 'We could not verify your uploaded media. Please upload it again.', values: safePostValues(formData) }
    }
    try {
      await createStandardPostWithAurora(user.id, {
        id: postId,
        category: data.category,
        body: data.body,
        media: data.media.map((media) => ({
          storagePath: media.storagePath,
          mimeType: media.mimeType,
          altText: media.altText || null,
          position: media.position,
          fileName: media.fileName,
          pageCount: media.pageCount,
        })),
        mentionProfileIds: data.mentionProfileIds,
      })
      await flagAutomatedModeration('post', postId, moderation)
      console.info('[feed_publish_success]', { postId, hasMedia: true, mediaCount: data.media.length })
    } catch (error) {
      console.error('[feed_publish_failed]', { stage: 'aurora_create', postId, hasMedia: true, errorCode: safeErrorCode(error) })
      await Promise.allSettled(data.media.map((media) => removeFeedImage(media.storagePath)))
      return { error: 'We could not attach your media, so the post was not published.', values: safePostValues(formData) }
    }
  } else {
    try {
      const postId = await createStandardPostWithAurora(user.id, {
        category: data.category,
        body: data.body,
        mentionProfileIds: data.mentionProfileIds,
      })
      await flagAutomatedModeration('post', postId, moderation)
      console.info('[feed_publish_success]', { postId, hasMedia: false })
    } catch (error) {
      console.error('[feed_publish_failed]', { stage: 'aurora_create', hasMedia: false, errorCode: safeErrorCode(error) })
      return { error: 'We could not publish your post. Your entries are still here.', values: safePostValues(formData) }
    }
  }
  revalidateSocialFeed()
  return { ok: true }
}

export async function loadFeedPage(input: FeedRequest) {
  const parsed = feedRequestSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: 'The next feed page request was invalid.' }
  try { return { ok: true as const, page: await getFeedPage(parsed.data) } }
  catch { return { ok: false as const, error: 'We could not load more posts.' } }
}

export async function loadReactionDetails(input: unknown) {
  const parsed = reactionDetailsSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: 'Invalid reaction request.' }
  try {
    const user = await requireAwsUser()
    const page = await loadReactionDetailsWithAurora(user.id, parsed.data)
    return { ok: true as const, page }
  } catch {
    return { ok: false as const, error: 'We could not load reactions.' }
  }
}

const postIdSchema = z.string().uuid()
const commentIdSchema = z.string().uuid()

export async function deletePost(postId: string): Promise<FeedActionResult> {
  const parsedId = postIdSchema.safeParse(postId)
  if (!parsedId.success) return { ok: false, error: 'Invalid post.' }
  const user = await requireAwsUser()
  try { await deletePostWithAurora(user.id, parsedId.data) }
  catch { return { ok: false, error: 'We could not delete this post.' } }
  revalidatePath('/saved')
  revalidateSocialFeed()
  return { ok: true }
}

export async function restoreDeletedPost(postId: string): Promise<FeedActionResult> {
  const parsedId = postIdSchema.safeParse(postId)
  if (!parsedId.success) return { ok: false, error: 'Invalid post.' }
  const user = await requireAwsUser()
  try {
    await restoreDeletedPostWithAurora(user.id, parsedId.data)
  } catch (error) {
    return {
      ok: false,
      error: safeErrorCode(error) === 'feed_post_restore_unavailable'
        ? 'This post can no longer be restored.'
        : 'We could not restore this post.',
    }
  }
  revalidateSocialFeed()
  return { ok: true }
}

export async function repostPost(postId: string): Promise<RepostActionResult> {
  const parsedId = postIdSchema.safeParse(postId)
  if (!parsedId.success) return { ok: false, error: 'Invalid post.' }
  const user = await requireAwsUser()
  try {
    const repostId = await repostPostWithAurora(user.id, parsedId.data)
    revalidateSocialFeed()
    return { ok: true, postId: repostId }
  } catch (error) {
    const code = safeErrorCode(error)
    if (code === 'feed_repost_duplicate') return { ok: false, error: 'You already reposted this post.' }
    if (code === 'feed_repost_source_unavailable' || code === 'feed_interaction_unavailable') {
      return { ok: false, error: 'This post is no longer available to repost.' }
    }
    return { ok: false, error: 'We could not repost this post.' }
  }
}

export async function setPostReaction(postId: string, reaction: PostReactionType | null): Promise<FeedActionResult> {
  const parsedId = postIdSchema.safeParse(postId)
  const parsedReaction = reaction === null ? { success: true as const, data: null } : reactionSchema.safeParse(reaction)
  if (!parsedId.success || !parsedReaction.success) return { ok: false, error: 'Invalid reaction.' }
  const user = await requireAwsUser()
  try { await setPostReactionWithAurora(user.id, parsedId.data, parsedReaction.data) }
  catch { return { ok: false, error: 'We could not update your reaction.' } }
  return { ok: true }
}

export async function setPostLiked(postId: string, liked: boolean): Promise<FeedActionResult> {
  const parsedId = postIdSchema.safeParse(postId)
  if (!parsedId.success || typeof liked !== 'boolean') return { ok: false, error: 'Invalid post.' }
  const user = await requireAwsUser()
  try { await setPostLikedWithAurora(user.id, parsedId.data, liked) }
  catch { return { ok: false, error: 'We could not update your like.' } }
  revalidateSocialFeed()
  return { ok: true }
}

export async function setCommentReaction(commentId: string, reaction: PostReactionType | null): Promise<FeedActionResult> {
  const parsedId = commentIdSchema.safeParse(commentId)
  const parsedReaction = reaction === null ? { success: true as const, data: null } : reactionSchema.safeParse(reaction)
  if (!parsedId.success || !parsedReaction.success) return { ok: false, error: 'Invalid reaction.' }
  const user = await requireAwsUser()
  try { await setCommentReactionWithAurora(user.id, parsedId.data, parsedReaction.data) }
  catch { return { ok: false, error: 'We could not update your comment reaction.' } }
  return { ok: true }
}

export async function setPostSaved(postId: string, saved: boolean): Promise<FeedActionResult> {
  const parsedId = postIdSchema.safeParse(postId)
  if (!parsedId.success || typeof saved !== 'boolean') return { ok: false, error: 'Invalid post.' }
  const user = await requireAwsUser()
  try { await setPostSavedWithAurora(user.id, parsedId.data, saved) }
  catch { return { ok: false, error: 'We could not update your saved posts.' } }
  revalidatePath('/home')
  revalidatePath('/saved')
  return { ok: true }
}

export async function addComment(_previousState: CommentActionState, formData: FormData): Promise<CommentActionState> {
  const raw = {
    postId: formData.get('postId'),
    body: formData.get('body'),
    parentCommentId: formData.get('parentCommentId'),
    mentionProfileIds: mentionIds(formData),
  }
  const parsed = commentInputSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      value: typeof raw.body === 'string' && raw.body.length <= 2000 ? raw.body : undefined,
    }
  }
  const moderation = assessPlatformText([parsed.data.body])
  if (moderation.decision === 'block') {
    return { error: moderationBlockMessage(), value: parsed.data.body }
  }
  const user = await requireAwsUser()
  try {
    const commentId = await addPostCommentWithAurora(
      user.id,
      parsed.data.postId,
      parsed.data.body,
      parsed.data.parentCommentId ?? null,
      parsed.data.mentionProfileIds,
    )
    await flagAutomatedModeration('comment', commentId, moderation)
    const comment = await hydrateComment(parsed.data.postId, commentId)
    if (!comment) return { error: 'We could not refresh your comment.', value: parsed.data.body }
    return { ok: true, comment }
  } catch {
    return { error: 'We could not add your comment.', value: parsed.data.body }
  }
}

export async function updateComment(_previousState: CommentActionState, formData: FormData): Promise<CommentActionState> {
  const rawBody = formData.get('body')
  const rawValue = typeof rawBody === 'string' && rawBody.length <= 2000 ? rawBody : undefined
  const parsed = updateCommentInputSchema.safeParse({
    commentId: formData.get('commentId'),
    body: rawBody,
    mentionProfileIds: mentionIds(formData),
  })
  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      value: rawValue,
    }
  }
  const moderation = assessPlatformText([parsed.data.body])
  if (moderation.decision === 'block') {
    return { error: moderationBlockMessage(), value: rawValue }
  }
  const user = await requireAwsUser()
  try {
    const updated = await updateCommentWithAurora(
      user.id,
      parsed.data.commentId,
      parsed.data.body,
      parsed.data.mentionProfileIds,
    )
    await flagAutomatedModeration('comment', updated.id, moderation)
    const comment = await hydrateComment(updated.postId, updated.id)
    if (!comment) return { error: 'We could not refresh your comment.', value: rawValue }
    return { ok: true, comment }
  } catch (error) {
    return {
      error: error instanceof Error && error.message === 'feed_comment_edit_expired'
        ? 'Comments can only be edited for 15 minutes after posting.'
        : 'We could not update this comment.',
      value: rawValue,
    }
  }
}

export async function deleteComment(commentId: string): Promise<DeleteCommentActionResult> {
  const parsed = deleteCommentInputSchema.safeParse({ commentId })
  if (!parsed.success) return { ok: false, error: 'Invalid comment.' }
  const user = await requireAwsUser()
  try {
    const deleted = await deleteCommentWithAurora(user.id, parsed.data.commentId)
    const comment = await hydrateComment(deleted.postId, deleted.id)
    return { ok: true, commentId: deleted.id, comment }
  } catch {
    return { ok: false, error: 'We could not delete this comment.' }
  }
}

export async function setPollVote(postId: string, optionId: string): Promise<FeedActionResult> {
  const parsed = pollVoteSchema.safeParse({ postId, optionId })
  if (!parsed.success) return { ok: false, error: 'Invalid poll option.' }
  const user = await requireAwsUser()
  try { await setPollVoteWithAurora(user.id, parsed.data.postId, parsed.data.optionId) }
  catch { return { ok: false, error: 'We could not record your vote.' } }
  revalidatePath('/home')
  return { ok: true }
}
