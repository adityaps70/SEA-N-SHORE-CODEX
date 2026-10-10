import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'
import { recordPaymentAudit } from '@/features/payments/audit'
import { gstDocumentsToCsv, isExportMonth, listGstDocumentsForMonth } from '@/features/tax/gst-export'
import { withTransaction } from '@/lib/db/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(error: string, status: number) {
  return Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

/** C4: the month's GST invoices and credit notes as CSV, for platform administrators only. Every export is audited. */
export async function GET(request: Request) {
  let adminId: string
  try {
    adminId = (await requirePlatformAdministratorUser()).id
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) return jsonError('Your session has expired. Sign in again and retry.', 401)
    if (error instanceof Error && error.message === 'admin_forbidden') return jsonError('Only Sea N Shore administrators can export GST documents.', 403)
    return jsonError('We could not check your access. Please try again.', 500)
  }

  const month = new URL(request.url).searchParams.get('month')
  if (!isExportMonth(month)) return jsonError('Choose a month (YYYY-MM).', 400)

  try {
    const rows = await withTransaction(async (client) => {
      const documents = await listGstDocumentsForMonth(client, month)
      await recordPaymentAudit(client, {
        actorType: 'admin',
        actorProfileId: adminId,
        subjectType: 'tax_export',
        subjectId: month,
        action: 'gst_documents_exported',
        details: { rows: documents.length },
      })
      return documents
    })
    return new Response(gstDocumentsToCsv(rows), {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="sea-n-shore-gst-documents-${month}.csv"`,
      },
    })
  } catch (error) {
    console.error('[gst_export_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return jsonError('The export could not be created. Please try again in a minute.', 500)
  }
}
