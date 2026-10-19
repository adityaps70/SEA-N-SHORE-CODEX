import { z } from 'zod'
import { jobShareService } from '@/features/jobs/share/share-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Round I (I1): the job page's og:image (WhatsApp and LinkedIn link previews): the default Portrait share image of
 * a public, open job, for anyone. Any other job (draft, closed, expired, deleted, plan-hidden) has none: 404.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) return new Response('Not found', { status: 404 })
  try {
    const result = await jobShareService.renderOpenGraph(id)
    if (!result) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } })
    return new Response(new Uint8Array(result.png), {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    })
  } catch (error) {
    console.error('[job_og_image_failed]', { name: error instanceof Error ? error.name : 'unknown' })
    return new Response('Unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
