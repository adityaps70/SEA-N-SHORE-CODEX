import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { getVerifiedUser } from '@/features/auth/queries'
import { buildCreditNotePdf, taxDocumentFileName } from '@/features/tax/tax-document-pdf'
import { getCreditNoteForViewer, isTaxDocumentId } from '@/features/tax/tax-document-queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function textResponse(message: string, status: number) {
  return new Response(message, { status, headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'text/plain; charset=utf-8' } })
}

/** C4: the GST credit note PDF, for the buyer of the invoice it reverses or a platform administrator. Anyone else gets 404. */
export async function GET(_request: Request, { params }: { params: Promise<{ creditNoteId: string }> }) {
  const user = await getVerifiedUser()
  if (!user) return textResponse('Sign in to download your credit note.', 401)
  const { creditNoteId } = await params
  if (!isTaxDocumentId(creditNoteId)) return textResponse('Not found', 404)

  try {
    const found = await getCreditNoteForViewer(creditNoteId, { profileId: user.id, canViewAll: () => canUsePlatformAdminAuthority(user.id) })
    if (!found) return textResponse('Not found', 404)
    const bytes = await buildCreditNotePdf(found.note, found.invoice)
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${taxDocumentFileName(found.note.creditNoteNumber)}"`,
      },
    })
  } catch (error) {
    console.error('[tax_credit_note_download_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return textResponse('The credit note could not be created. Please try again.', 500)
  }
}
