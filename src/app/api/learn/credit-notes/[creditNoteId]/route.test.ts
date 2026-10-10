import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'

const mocks = vi.hoisted(() => ({
  getVerifiedUser: vi.fn(),
  canUsePlatformAdminAuthority: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.getVerifiedUser }))
vi.mock('@/features/admin/mfa-gate', () => ({ canUsePlatformAdminAuthority: mocks.canUsePlatformAdminAuthority }))
vi.mock('@/lib/db/client', () => ({ query: mocks.query, withTransaction: vi.fn() }))

import { sampleCreditNote, sampleInvoice } from '@/features/tax/tax-test-fixtures'
import { GET } from './route'

const invoice = sampleInvoice({ supplyType: 'inter_state', buyerCompany: null, buyerGstin: null })
const note = sampleCreditNote(invoice)
const buyerId = invoice.buyerProfileId!

const invoiceRow = {
  id: invoice.id, invoice_number: invoice.invoiceNumber, financial_year: invoice.financialYear, order_id: invoice.orderId,
  buyer_profile_id: buyerId, invoice_date: invoice.invoiceDate, issued_at: invoice.issuedAt, supplier: JSON.stringify(invoice.supplier),
  buyer_name: invoice.buyerName, buyer_company: null, buyer_gstin: null, place_of_supply_code: invoice.placeOfSupplyCode,
  place_of_supply_name: invoice.placeOfSupplyName, supply_type: invoice.supplyType, lut_arn: null, sac: invoice.sac,
  description: invoice.description, currency: invoice.currency, gst_rate_basis_points: invoice.gstRateBasisPoints,
  taxable_minor: invoice.taxableMinor, cgst_minor: 0, sgst_minor: 0, igst_minor: invoice.igstMinor, total_minor: invoice.totalMinor,
  order_reference: invoice.orderReference,
}
const noteRow = {
  id: note.id, credit_note_number: note.creditNoteNumber, financial_year: note.financialYear, invoice_id: invoice.id,
  note_date: note.noteDate, issued_at: note.issuedAt, reason: note.reason, taxable_minor: note.taxableMinor, cgst_minor: 0,
  sgst_minor: 0, igst_minor: note.igstMinor, total_minor: note.totalMinor,
}

function get(id = note.id) {
  return GET(new Request(`https://seanshore.example/api/learn/credit-notes/${id}`), { params: Promise.resolve({ creditNoteId: id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getVerifiedUser.mockResolvedValue({ id: buyerId })
  mocks.canUsePlatformAdminAuthority.mockResolvedValue(false)
  mocks.query.mockImplementation(async (text: string) => (text.includes('public.tax_credit_notes') ? [noteRow] : [invoiceRow]))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/learn/credit-notes/[creditNoteId]', () => {
  it('asks signed-out visitors to sign in and hides ids that are not UUIDs', async () => {
    mocks.getVerifiedUser.mockResolvedValueOnce(null)
    expect((await get()).status).toBe(401)
    expect((await get('not-a-uuid')).status).toBe(404)
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('gives the buyer the credit note PDF', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="SNC-26-27-000001.pdf"')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect((await PDFDocument.load(new Uint8Array(await response.arrayBuffer()))).getPageCount()).toBe(1)
  })

  it('returns 404 to anyone else, and to everyone for a missing note; administrators with MFA may read it', async () => {
    mocks.getVerifiedUser.mockResolvedValue({ id: '99999999-9999-4999-8999-999999999999' })
    expect((await get()).status).toBe(404)
    mocks.canUsePlatformAdminAuthority.mockResolvedValue(true)
    expect((await get()).status).toBe(200)
    mocks.query.mockResolvedValue([])
    expect((await get()).status).toBe(404)
  })
})
