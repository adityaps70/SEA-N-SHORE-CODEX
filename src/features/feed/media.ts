import {
  createMediaUploadUrl,
  deleteMediaObject,
  getMediaObject,
  headMediaObject,
  putMediaObject,
} from '@/lib/aws/storage'
import { PDFDocument } from 'pdf-lib'
import { createMediaImageSrc } from '@/lib/images/media-image-src'
import { cdnImageSrc } from '@/lib/media-cdn/media-cdn'
import { prepareMediaForCdn } from '@/lib/media-cdn/prepare-media'
import {
  POST_DOCUMENT_MAX_BYTES,
  POST_DOCUMENT_MAX_PAGES,
  buildPostMediaStoragePath,
  isOwnedPostMediaStoragePath,
  validatePostMediaMetadata,
  type PostMediaMime,
} from './media-policy'
import { verifyStoredUploadSignature } from '@/lib/uploads/verify-stored-upload'

function buildFirstPartyMediaUrl(path: string): string {
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return `/api/feed-media/${encodedPath}`
}

const POST_PHOTO = /\.(?:jpe?g|png|webp)$/i

/**
 * URLs for post media the viewer may already see (callers resolve only visible posts).
 * Round P3 (B7): post photos go straight to their signed CDN sizes once the media CDN is
 * configured. Videos and PDFs keep the first-party route, which checks visibility on every
 * request: videos redirect from it (to the CDN once configured), and the video player derives the
 * poster and its backfill from that route's URL; PDFs are read same-origin by pdf.js.
 */
export async function resolveFeedMediaUrls(paths: string[]): Promise<Map<string, string>> {
  if (!paths.length) return new Map()

  const entries = await Promise.all(
    [...new Set(paths)].map(async (path) => [
      path,
      path.startsWith('profiles/')
        ? await createMediaImageSrc(path)
        : (POST_PHOTO.test(path) ? cdnImageSrc(path) : null) ?? buildFirstPartyMediaUrl(path),
    ] as const),
  )

  return new Map(entries)
}

function safeErrorName(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  return /^[A-Za-z0-9_.-]{1,80}$/.test(name) ? name : 'UnknownError'
}

export async function createPendingPostMediaUpload(input: {
  profileId: string
  mimeType: string
  size: number
  postId?: string
}): Promise<{
  postId: string
  storagePath: string
  mimeType: PostMediaMime
  size: number
  uploadUrl: string
}> {
  const metadata = validatePostMediaMetadata({
    mimeType: input.mimeType,
    size: input.size,
  })
  if (!metadata.ok) throw new Error('feed_media_policy_invalid')

  const postId = input.postId ?? crypto.randomUUID()
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
  pageCount?: number | null
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

  // Round P3: the bytes must really be the declared image, video or PDF (PDFs are also parsed below).
  const content = await verifyStoredUploadSignature(input.storagePath, metadata.mimeType, input.size)
  if (content === 'unavailable') throw new Error('feed_media_unavailable')
  if (content === 'mismatch') throw new Error('feed_media_metadata_mismatch')

  if (metadata.mimeType === 'application/pdf') {
    let pageCount: number
    try {
      const document = await getMediaObject({
        key: input.storagePath,
        maxBytes: POST_DOCUMENT_MAX_BYTES,
      })
      const pdf = await PDFDocument.load(document.body)
      pageCount = pdf.getPageCount()
    } catch {
      throw new Error('feed_media_document_invalid')
    }

    if (pageCount < 1 || pageCount > POST_DOCUMENT_MAX_PAGES) {
      throw new Error('feed_media_document_page_limit')
    }
    if (input.pageCount == null || input.pageCount !== pageCount) {
      throw new Error('feed_media_document_page_mismatch')
    }
  }

  // Round P3 (B7, Part D): a photo's WebP sizes or a video's CDN copy, before the post is saved.
  try {
    await prepareMediaForCdn({ key: input.storagePath, contentType: metadata.mimeType })
  } catch (error) {
    console.error('[feed-media] cdn_prepare_failed', { errorName: safeErrorName(error) })
    throw new Error('feed_media_unavailable')
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
