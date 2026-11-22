import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'
import { recordPaymentAudit } from '@/features/payments/audit'
import { readClient } from '@/features/payouts/payout-runtime'
import { isPeriod } from '@/features/payouts/seller-invoice-rules'
import { listTdsReportRows, tdsReportToCsv } from '@/features/payouts/tds-report'
import { backgroundFetchRefused, isBackgroundFetch } from '@/lib/http/background-fetch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(error: string, status: number) {
  return Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

/** CSV of the TDS on course payouts created in one month (IST), for platform administrators only. Audited. */
export async function GET(request: Request) {
  // Owner (21 Nov): a prefetch never builds or audits a TDS report; only a person's own download does.
  if (isBackgroundFetch(request.headers)) return backgroundFetchRefused()
  let adminId: string
  try {
    adminId = (await requirePlatformAdministratorUser()).id
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) return jsonError('Your session has expired. Sign in again and retry.', 401)
    if (error instanceof Error && error.message === 'admin_forbidden') return jsonError('Only Sea N Shore administrators can export the TDS report.', 403)
    return jsonError('We could not check your access. Please try again.', 500)
  }

  const month = new URL(request.url).searchParams.get('month') ?? ''
  if (!isPeriod(month)) return jsonError('Choose the month to export, as YYYY-MM (for example 2026-09).', 400)

  try {
    const rows = await listTdsReportRows(readClient, month)
    await recordPaymentAudit(readClient, {
      actorType: 'admin',
      actorProfileId: adminId,
      subjectType: 'tax_export',
      subjectId: month,
      action: 'tds_report_exported',
      details: { rows: rows.length },
    })
    return new Response(tdsReportToCsv(rows), {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="sea-n-shore-tds-${month}.csv"`,
      },
    })
  } catch (error) {
    console.error('[tds_report_export_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return jsonError('The TDS report could not be created. Please try again in a minute.', 500)
  }
}
