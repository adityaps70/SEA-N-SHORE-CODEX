import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { getVerifiedUser } from '@/features/auth/queries'
import { trainingDashboardRepository } from '@/features/learning/company-training/dashboard-repository'
import { SeatError } from '@/features/learning/company-training/seat-rules'
import { backgroundFetchRefused, isBackgroundFetch } from '@/lib/http/background-fetch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function textError(message: string, status: number) {
  return new Response(message, { status, headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'text/plain; charset=utf-8' } })
}

/**
 * D3: CSV of a company's assigned seats (learner, vessel, rank, course, progress and certificate for members who share),
 * for the people who run its crew training and platform admins. Every export is audited with its row count.
 */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  // Owner (21 Nov): a prefetch never builds or audits a crew training export; only a person's own download does.
  if (isBackgroundFetch(request.headers)) return backgroundFetchRefused()
  const user = await getVerifiedUser()
  if (!user) return textError('Sign in to export your crew training.', 401)
  const { companyId } = await params
  if (!UUID.test(companyId)) return textError('Not found', 404)
  try {
    let csv: string
    try {
      csv = await trainingDashboardRepository.exportCsv({ actorId: user.id }, companyId)
    } catch (error) {
      if (!(error instanceof SeatError && error.code === 'company_training_not_allowed')) throw error
      if (!await canUsePlatformAdminAuthority(user.id)) throw error
      csv = await trainingDashboardRepository.exportCsv({ actorId: user.id, platformAdmin: true }, companyId)
    }
    const date = new Date().toISOString().slice(0, 10)
    return new Response(csv, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="sea-n-shore-crew-training-${date}.csv"`,
      },
    })
  } catch (error) {
    if (error instanceof SeatError) return textError('Not found', 404)
    console.error('[company_training_export_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return textError('The export could not be created. Please try again.', 500)
  }
}
