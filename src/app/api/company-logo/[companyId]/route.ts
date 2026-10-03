import { z } from 'zod'
import { getVerifiedUser } from '@/features/auth/queries'
import { query } from '@/lib/db/client'
import { getMediaObject } from '@/lib/aws/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const companyIdSchema = z.string().uuid()
const MAX_COMPANY_LOGO_BYTES = 5 * 1024 * 1024
const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export async function GET(
  _request: Request,
  context: { params: Promise<{ companyId: string }> },
): Promise<Response> {
  const viewer = await getVerifiedUser()
  if (!viewer) return new Response(null, { status: 401 })

  const { companyId } = await context.params
  const parsed = companyIdSchema.safeParse(companyId)
  if (!parsed.success) return new Response(null, { status: 404 })

  const rows = await query<{ logo_path: string | null }>(
    'select logo_path from public.companies where id = $1 limit 1',
    [parsed.data],
  )
  const storagePath = rows[0]?.logo_path?.trim()
  if (!storagePath) return new Response(null, { status: 404 })

  try {
    const object = await getMediaObject({
      key: storagePath,
      maxBytes: MAX_COMPANY_LOGO_BYTES,
    })
    const contentType = object.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) return new Response(null, { status: 404 })

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
