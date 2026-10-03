import {
  createMediaReadUrl,
  createMediaUploadUrl,
  deleteMediaObject,
  headMediaObject,
} from '@/lib/aws/storage'
import {
  buildLearningMediaStoragePath,
  isOwnedLearningMediaStoragePath,
  validateLearningMediaMetadata,
  type LearningMediaKind,
} from './media-policy'

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

export async function verifyLearningMediaObject(input: {
  userId: string
  courseId: string
  kind: LearningMediaKind
  storagePath: string
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
  if (!isOwnedLearningMediaStoragePath({
    userId: input.userId,
    courseId: input.courseId,
    kind: input.kind,
    storagePath: input.storagePath,
    mimeType: metadata.mimeType,
  })) {
    throw new Error('learning_media_reference_invalid')
  }

  return stored
}

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
}) {
  await verifyLearningMediaObject(input)
  return createMediaReadUrl(input.storagePath)
}
