import { createHash } from 'node:crypto'
import { z } from 'zod'
import { AwsAuthenticationRequiredError, requireAwsUser } from '@/features/auth/aws-queries'
import { JobShareError } from '@/features/jobs/share/share-service'
import { jobShareService } from '@/features/jobs/share/share-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Round I (I1): the job share image, for the job's poster (verified recruiter or verified organization), or a
 * platform administrator. ?size=…&look=…&opts=… pick the design; ?format=json returns the layout's "fits" check
 * instead of the PNG; ?download=1 sends it as a file. Cached in the task by job, updated_at, options and settings.
 */
function json(payload: Record<string, unknown>, status: number) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) return json({ error: 'not_found' }, 404)
  let viewerId: string
  try {
    viewerId = (await requireAwsUser()).id
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) return json({ error: 'sign_in' }, 401)
    throw error
  }
  const params = new URL(request.url).searchParams
  try {
    if (params.get('format') === 'json') {
      const layout = await jobShareService.layoutForViewer(viewerId, id, params)
      return json({ fits: layout.fits, titleSize: layout.title.size, titleLines: layout.title.lines.length, truncated: layout.title.truncated }, 200)
    }
    const { png, cacheKey } = await jobShareService.renderForViewer(viewerId, id, params)
    const etag = `"${createHash('sha256').update(cacheKey).digest('hex').slice(0, 32)}"`
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'private, max-age=300' } })
    const headers: Record<string, string> = { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300', ETag: etag }
    if (params.get('download') === '1') headers['Content-Disposition'] = `attachment; filename="sea-n-shore-job-${params.get('size') ?? 'portrait'}.png"`
    return new Response(new Uint8Array(png), { status: 200, headers })
  } catch (error) {
    if (error instanceof JobShareError) {
      if (error.code === 'job_share_closed') return json({ error: 'closed' }, 409)
      return json({ error: 'forbidden' }, 403)
    }
    console.error('[job_share_image_failed]', { name: error instanceof Error ? error.name : 'unknown' })
    return json({ error: 'failed' }, 500)
  }
}
