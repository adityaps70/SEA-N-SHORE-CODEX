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

import { sampleInvoice } from '@/features/tax/tax-test-fixtures'
import { GET } from './route'

const invoice = sampleInvoice()
const buyerId = invoice.buyerProfileId!

/** The stored invoice row, as public.tax_invoices returns it. */
const invoiceRow = {
  id: invoice.id, invoice_number: invoice.invoiceNumber, financial_year: invoice.financialYear, order_id: invoice.orderId,
  buyer_profile_id: buyerId, invoice_date: invoice.invoiceDate, issued_at: invoice.issuedAt, supplier: invoice.supplier,
  buyer_name: invoice.buyerName, buyer_company: invoice.buyerCompany, buyer_gstin: invoice.buyerGstin,
  place_of_supply_code: invoice.placeOfSupplyCode, place_of_supply_name: invoice.placeOfSupplyName, supply_type: invoice.supplyType,
  lut_arn: null, sac: invoice.sac, description: invoice.description, currency: invoice.currency,
  gst_rate_basis_points: invoice.gstRateBasisPoints, taxable_minor: String(invoice.taxableMinor), cgst_minor: String(invoice.cgstMinor),
  sgst_minor: String(invoice.sgstMinor), igst_minor: '0', total_minor: String(invoice.totalMinor), order_reference: invoice.orderReference,
}

function get(id = invoice.id) {
  return GET(new Request(`https://seanshore.example/api/learn/invoices/${id}`), { params: Promise.resolve({ invoiceId: id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getVerifiedUser.mockResolvedValue({ id: buyerId })
  mocks.canUsePlatformAdminAuthority.mockResolvedValue(false)
  mocks.query.mockResolvedValue([invoiceRow])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/learn/invoices/[invoiceId]', () => {
  it('asks signed-out visitors to sign in', async () => {
    mocks.getVerifiedUser.mockResolvedValue(null)
    const response = await get()
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('returns 404 for an id that is not a UUID or an invoice that does not exist', async () => {
    expect((await get('SNS-26-27-000001')).status).toBe(404)
    expect(mocks.query).not.toHaveBeenCalled()
    mocks.query.mockResolvedValueOnce([])
    expect((await get()).status).toBe(404)
  })

  it('gives the buyer a private PDF download named after the invoice number', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="SNS-26-27-000001.pdf"')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
    expect(mocks.canUsePlatformAdminAuthority).not.toHaveBeenCalled()
    expect((mocks.query.mock.calls[0] as unknown as [string, unknown[]])[1]).toEqual([invoice.id])
  })

  it('hides another buyer’s invoice (404) unless the viewer is a platform administrator with MFA', async () => {
    mocks.getVerifiedUser.mockResolvedValue({ id: '99999999-9999-4999-8999-999999999999' })
    expect((await get()).status).toBe(404)
    expect(mocks.canUsePlatformAdminAuthority).toHaveBeenCalledWith('99999999-9999-4999-8999-999999999999')

    mocks.canUsePlatformAdminAuthority.mockResolvedValue(true)
    const admin = await get()
    expect(admin.status).toBe(200)
    expect(admin.headers.get('content-type')).toBe('application/pdf')
  })
})
