import {
  createMediaReadUrl,
  createMediaUploadUrl,
  deleteMediaObject,
  headMediaObject,
} from '@/lib/aws/storage'
import { prepareMediaForCdn } from '@/lib/media-cdn/prepare-media'
import { query as databaseQuery } from '@/lib/db/client'
import { enqueueRendition } from './media-renditions'
import {
  buildLearningMediaStoragePath,
  isOwnedLearningMediaStoragePath,
  validateLearningMediaMetadata,
  type LearningMediaKind,
} from './media-policy'
import { verifyStoredUploadSignature } from '@/lib/uploads/verify-stored-upload'

export async function createPendingLearningMediaUpload(input: {
  userId: string
  courseId: string
  kind: LearningMediaKind
  mimeType: string
  size: number
}) {
  const metadata = validateLearningMediaMetadata(input)
  if (!metadata.ok) throw new Error('learning_media_policy_invalid')

  const storagePath = buildLearningMediaStoragePath({
    userId: input.userId,
    courseId: input.courseId,
    kind: input.kind,
    mimeType: metadata.mimeType,
  })
  const uploadUrl = await createMediaUploadUrl({ key: storagePath, contentType: metadata.mimeType })

  return {
    storagePath,
    mimeType: metadata.mimeType,
    size: input.size,
    uploadUrl,
  }
}

/**
 * Confirms a stored file is the declared kind and size. A new upload must also be the caller's own
 * upload for this course; a file the course already references (for example one another manager
 * uploaded, or one a draft revision carries over from the live course) only needs to be valid.
 */
export async function verifyLearningMediaObject(input: {
  userId: string
  courseId: string
  kind: LearningMediaKind
  storagePath: string
  alreadyAttached?: boolean
}) {
  let stored: Awaited<ReturnType<typeof headMediaObject>>
  try {
    stored = await headMediaObject(input.storagePath)
  } catch {
    throw new Error('learning_media_unavailable')
  }

  if (!stored.contentType || stored.contentLength === null) {
    throw new Error('learning_media_metadata_mismatch')
  }
  const metadata = validateLearningMediaMetadata({
    kind: input.kind,
    mimeType: stored.contentType,
    size: stored.contentLength,
  })
  if (!metadata.ok) throw new Error('learning_media_metadata_mismatch')
  if (!input.alreadyAttached && !isOwnedLearningMediaStoragePath({
    userId: input.userId,
    courseId: input.courseId,
    kind: input.kind,
    storagePath: input.storagePath,
    mimeType: metadata.mimeType,
  })) {
    throw new Error('learning_media_reference_invalid')
  }
  // Round P3: a new upload's bytes must really be the declared type (files already in the course were
  // checked when they were added).
  if (!input.alreadyAttached) {
    const content = await verifyStoredUploadSignature(input.storagePath, metadata.mimeType, stored.contentLength)
    if (content === 'unavailable') throw new Error('learning_media_unavailable')
    if (content === 'mismatch') throw new Error('learning_media_content_mismatch')
  }
  // Round P3 (B7): course thumbnails and lesson images get their CDN sizes (an unchanged file
  // re-checked on save already has them).
  if (CDN_IMAGE_KINDS.has(input.kind)) {
    try {
      await prepareMediaForCdn({ key: input.storagePath, contentType: metadata.mimeType, skipIfPresent: true })
    } catch {
      throw new Error('learning_media_unavailable')
    }
  }
  // Round P3 (Part D): a newly uploaded trailer or lesson video is queued for MediaConvert. The players use the
  // uploaded file until its rendition is ready, so a queueing hiccup never blocks the save.
  if (!input.alreadyAttached && (input.kind === 'course_trailer' || input.kind === 'lesson_video')) {
    await enqueueRendition(databaseQuery, input.storagePath).catch((error: unknown) => {
      console.error('[learning_media_transcode_enqueue_failed]', { errorName: error instanceof Error ? error.name : 'unknown' })
    })
  }

  return stored
}

const CDN_IMAGE_KINDS: ReadonlySet<LearningMediaKind> = new Set(['course_thumbnail', 'lesson_image'])

export async function removeLearningMediaObject(input: {
  userId: string
  courseId: string
  kind: LearningMediaKind
  storagePath: string
}) {
  if (!isOwnedLearningMediaStoragePath(input)) throw new Error('learning_media_reference_invalid')
  await deleteMediaObject(input.storagePath)
}

export async function resolveLearningMediaReadUrl(input: {
  userId: string
  courseId: string
  kind: LearningMediaKind
  storagePath: string
  alreadyAttached?: boolean
}) {
  await verifyLearningMediaObject(input)
  return createMediaReadUrl(input.storagePath)
}
