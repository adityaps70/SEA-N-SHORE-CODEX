import { getVerifiedUser } from '@/features/auth/queries'
import { publicCourseRepository } from '@/features/learning/public-course-repository'
import { getMediaObject } from '@/lib/aws/storage'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const THUMBNAIL_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpe?g|png|webp)$/i
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024

function canonicalThumbnailKey(path: string[]) {
  if (path.length !== 5) return null
  const [root, userId, courseId, kind, filename] = path
  if (root !== 'learning' || kind !== 'course_thumbnail') return null
  if (!userId || !UUID_PATTERN.test(decodeURIComponent(userId))) return null
  if (!courseId || !UUID_PATTERN.test(courseId)) return null
  if (!filename || !THUMBNAIL_PATTERN.test(filename)) return null
  return path.join('/')
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params
  const key = canonicalThumbnailKey(path)
  if (!key) return new Response('Not found', { status: 404 })

  // Signed-out visitors (and link-preview crawlers) get the cover of a public course only.
  const user = await getVerifiedUser()
  const publicCover = user ? false : await publicCourseRepository.isPublicCourseThumbnail(key).catch(() => false)
  if (!user && !publicCover) return new Response('Unauthorized', { status: 401 })

  try {
    const object = await getMediaObject({ key, maxBytes: MAX_THUMBNAIL_BYTES })
    const body = Uint8Array.from(object.body).buffer
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': object.contentType ?? 'application/octet-stream',
        ...(object.contentLength === null ? {} : { 'content-length': String(object.contentLength) }),
        // A public cover may be cached briefly by anyone; everything else stays private.
        'cache-control': publicCover ? 'public, max-age=600' : 'private, max-age=3600, stale-while-revalidate=86400',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
