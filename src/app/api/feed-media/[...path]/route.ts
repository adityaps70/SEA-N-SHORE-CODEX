import { getVerifiedUser } from '@/features/auth/queries'
import { getMediaObject } from '@/lib/aws/storage'

const MAX_FEED_MEDIA_BYTES = 200 * 1024 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
}

function canonicalFeedMediaKey(parts: string[]): string | null {
  if (parts.length !== 3) return null
  const [profileId, postId, filename] = parts
  if (!profileId || !postId || !filename) return null
  if (!UUID_PATTERN.test(profileId) || !UUID_PATTERN.test(postId)) return null

  const match = filename.match(/^([0-9a-f-]+)\.([a-z0-9]+)$/i)
  if (!match) return null

  const [, objectId, extensionRaw] = match
  if (!objectId || !UUID_PATTERN.test(objectId)) return null
  const extension = extensionRaw?.toLowerCase() ?? ''
  if (!CONTENT_TYPE_BY_EXTENSION[extension]) return null

  return `${profileId}/${postId}/${objectId}.${extension}`
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const user = await getVerifiedUser()
  if (!user) return new Response(null, { status: 401 })

  const { path } = await context.params
  const key = canonicalFeedMediaKey(path)
  if (!key) return new Response(null, { status: 404 })

  try {
    const object = await getMediaObject({
      key,
      maxBytes: MAX_FEED_MEDIA_BYTES,
    })
    const extension = key.slice(key.lastIndexOf('.') + 1)
    const contentType = object.contentType || CONTENT_TYPE_BY_EXTENSION[extension] || 'application/octet-stream'
    const body = Uint8Array.from(object.body).buffer

    return new Response(body, {
      status: 200,
      headers: {
        'cache-control': 'private, max-age=3600',
        'content-length': String(object.contentLength),
        'content-type': contentType,
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return new Response(null, { status: 404 })
  }
}
