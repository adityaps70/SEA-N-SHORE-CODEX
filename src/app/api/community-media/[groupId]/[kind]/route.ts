import { z } from 'zod'
import { getVerifiedUser } from '@/features/auth/queries'
import { COMMUNITY_IMAGE_MAX_BYTES, isCommunityImageContentType, isCommunityMediaKind } from '@/features/community/media'
import { query } from '@/lib/db/client'
import { getMediaObject } from '@/lib/aws/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const groupIdSchema = z.string().uuid()

/**
 * Streams a community banner (`cover`) or photo (`icon`) to signed-in members. Archived groups
 * still serve their images so site admins can look at them; `communityImageUrl` adds a version
 * query so the private cache is busted whenever the stored path changes.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ groupId: string; kind: string }> },
): Promise<Response> {
  const viewer = await getVerifiedUser()
  if (!viewer) return new Response(null, { status: 401 })

  const { groupId, kind } = await context.params
  const parsed = groupIdSchema.safeParse(groupId)
  if (!parsed.success || !isCommunityMediaKind(kind)) return new Response(null, { status: 404 })

  const rows = await query<{ cover_path: string | null; icon_path: string | null }>(
    'select cover_path, icon_path from public.community_groups where id = $1 limit 1',
    [parsed.data],
  )
  const storagePath = (kind === 'cover' ? rows[0]?.cover_path : rows[0]?.icon_path)?.trim()
  if (!storagePath) return new Response(null, { status: 404 })

  try {
    const object = await getMediaObject({
      key: storagePath,
      maxBytes: COMMUNITY_IMAGE_MAX_BYTES,
    })
    const contentType = object.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
    if (!isCommunityImageContentType(contentType)) return new Response(null, { status: 404 })

    return new Response(Uint8Array.from(object.body).buffer, {
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
