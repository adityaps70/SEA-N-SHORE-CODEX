import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'
import { subscribersToCsv } from '@/features/newsletter/csv'
import { newsletterRepository } from '@/features/newsletter/repository'
import { isNewsletterTopic, NEWSLETTER_STATUSES, type NewsletterStatus } from '@/features/newsletter/topics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(error: string, status: number) {
  return Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

/** CSV export of newsletter subscribers for platform administrators only. */
export async function GET(request: Request) {
  let adminId: string
  try {
    adminId = (await requirePlatformAdministratorUser()).id
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) return jsonError('Your session has expired. Sign in again and retry.', 401)
    if (error instanceof Error && error.message === 'admin_forbidden') return jsonError('Only Sea N Shore administrators can export newsletter subscribers.', 403)
    return jsonError('We could not check your access. Please try again.', 500)
  }

  const params = new URL(request.url).searchParams
  const statusParam = params.get('status')
  const topicParam = params.get('topic')
  const status = NEWSLETTER_STATUSES.includes(statusParam as NewsletterStatus) ? (statusParam as NewsletterStatus) : null
  const topic = isNewsletterTopic(topicParam) ? topicParam : null
  const q = params.get('q')?.slice(0, 120) ?? ''

  try {
    const rows = await newsletterRepository.exportRows({ q, status, topic })
    await newsletterRepository.recordExport(adminId, rows.length, { status, topic, q: Boolean(q.trim()) })
    const date = new Date().toISOString().slice(0, 10)
    return new Response(subscribersToCsv(rows), {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="sea-n-shore-newsletter-subscribers-${date}.csv"`,
      },
    })
  } catch (error) {
    console.error('[newsletter_export_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return jsonError('The export could not be created. Please try again in a minute.', 500)
  }
}
