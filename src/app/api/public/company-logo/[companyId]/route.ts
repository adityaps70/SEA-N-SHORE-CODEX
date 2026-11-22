import { z } from 'zod'
import { query } from '@/lib/db/client'
import { getMediaObject } from '@/lib/aws/storage'
import { cdnImageRedirect } from '@/lib/media-cdn/cdn-redirect'
import { PUBLIC_COMPANY_LOGO_CACHE_CONTROL } from '@/features/organizations/company-logo-path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const companyIdSchema = z.string().uuid()
const MAX_COMPANY_LOGO_BYTES = 5 * 1024 * 1024
const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
// A short shared cache for "no public logo here", so repeated misses do not all reach the database.
const NOT_FOUND_CACHE_CONTROL = 'public, max-age=60, s-maxage=60'

function notFound() {
  return new Response(null, { status: 404, headers: { 'cache-control': NOT_FOUND_CACHE_CONTROL } })
}

/**
 * Request cuts (owner-approved 18 Nov): a verified organization's logo for everyone, cached once at CloudFront.
 *
 * This route never reads cookies or the session, and its CloudFront behaviour forwards none, so one cached answer
 * serves every visitor (the signed-in route /api/company-logo is cached per session). It serves only verified
 * organizations' logos: anything else is a 404, so an unverified logo is never public or cached here.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ companyId: string }> },
): Promise<Response> {
  const { companyId } = await context.params
  const parsed = companyIdSchema.safeParse(companyId)
  if (!parsed.success) return notFound()

  const rows = await query<{ logo_path: string | null; is_verified: boolean | null }>(
    'select logo_path, is_verified from public.companies where id = $1 limit 1',
    [parsed.data],
  )
  if (rows[0]?.is_verified !== true) return notFound()
  const storagePath = rows[0].logo_path?.trim()
  if (!storagePath) return notFound()

  // A redirect to the logo's signed CDN size. Its lifetime here is far shorter than the signature's (see
  // PUBLIC_COMPANY_LOGO_MAX_AGE_SECONDS), so a cached redirect never points at an expired URL.
  const redirect = cdnImageRedirect(storagePath, { width: 320, cacheControl: PUBLIC_COMPANY_LOGO_CACHE_CONTROL })
  if (redirect) return redirect

  try {
    const object = await getMediaObject({ key: storagePath, maxBytes: MAX_COMPANY_LOGO_BYTES })
    const contentType = object.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) return notFound()

    return new Response(Uint8Array.from(object.body).buffer, {
      status: 200,
      headers: {
        'cache-control': PUBLIC_COMPANY_LOGO_CACHE_CONTROL,
        'content-length': String(object.contentLength),
        'content-type': contentType,
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return notFound()
  }
}
