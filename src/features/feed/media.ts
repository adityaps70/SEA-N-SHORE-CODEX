import {
  createMediaReadUrl,
  createMediaUploadUrl,
  deleteMediaObject,
  headMediaObject,
  putMediaObject,
} from '@/lib/aws/storage'
import {
  buildPostMediaStoragePath,
  isOwnedPostMediaStoragePath,
  validatePostMediaMetadata,
} from './media-policy'

export async function resolveFeedMediaUrls(paths: string[]): Promise<Map<string, string>> {
  if (!paths.length) return new Map()

  const urls = new Map<string, string>()
  await Promise.all(paths.map(async (path) => {
    try {
      const signedUrl = await createMediaReadUrl(path)
      urls.set(path, signedUrl)
    } catch {
      // One unavailable object should not prevent the rest of the feed from rendering.
    }
  }))
  return urls
}

function safeErrorName(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  return /^[A-Za-z0-9_.-]{1,80}$/.test(name) ? name : 'UnknownError'
}

export async function createPendingPostMediaUpload(input: {
  profileId: string
  mimeType: string
  size: number
}): Promise<{
  postId: string
  storagePath: string
  mimeType: string
  size: number
  uploadUrl: string
}> {
  const metadata = validatePostMediaMetadata({
    mimeType: input.mimeType,
    size: input.size,
  })
  if (!metadata.ok) throw new Error('feed_media_policy_invalid')

  const postId = crypto.randomUUID()
  const storagePath = buildPostMediaStoragePath({
    profileId: input.profileId,
    postId,
    mimeType: metadata.mimeType,
  })
  const uploadUrl = await createMediaUploadUrl({
    key: storagePath,
    contentType: metadata.mimeType,
  })

  return {
    postId,
    storagePath,
    mimeType: metadata.mimeType,
    size: input.size,
    uploadUrl,
  }
}

export async function verifyPendingPostMedia(input: {
  profileId: string
  postId: string
  storagePath: string
  mimeType: string
  size: number
}): Promise<void> {
  const metadata = validatePostMediaMetadata({
    mimeType: input.mimeType,
    size: input.size,
  })
  if (!metadata.ok) throw new Error('feed_media_policy_invalid')

  const ownedPath = isOwnedPostMediaStoragePath({
    profileId: input.profileId,
    postId: input.postId,
    storagePath: input.storagePath,
    mimeType: metadata.mimeType,
  })
  if (!ownedPath) throw new Error('feed_media_reference_invalid')

  let stored: Awaited<ReturnType<typeof headMediaObject>>
  try {
    stored = await headMediaObject(input.storagePath)
  } catch {
    throw new Error('feed_media_unavailable')
  }

  if (stored.contentType !== metadata.mimeType || stored.contentLength !== input.size) {
    throw new Error('feed_media_metadata_mismatch')
  }
}

export async function uploadFeedImage(input: {
  profileId: string
  postId: string
  file: File
  extension: string
}): Promise<string> {
  const storagePath = `${input.profileId}/${input.postId}/${crypto.randomUUID()}.${input.extension}`

  try {
    const body = new Uint8Array(await input.file.arrayBuffer())
    await putMediaObject({
      key: storagePath,
      body,
      contentType: input.file.type,
    })
  } catch (error) {
    console.error('[feed_media_upload_failed]', {
      errorName: safeErrorName(error),
    })
    throw new Error('feed_media_upload_failed')
  }

  return storagePath
}

export async function removeFeedImage(storagePath: string): Promise<void> {
  await deleteMediaObject(storagePath)
}
