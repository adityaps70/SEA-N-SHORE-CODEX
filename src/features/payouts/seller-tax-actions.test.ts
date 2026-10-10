import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  requireAdmin: vi.fn(),
  withTransaction: vi.fn(),
  canManageSeller: vi.fn(),
  savePayoutTaxProfile: vi.fn(),
  checkInvoiceableMonth: vi.fn(),
  createSellerInvoice: vi.fn(),
  reviewSellerInvoice: vi.fn(),
  createSellerInvoiceUpload: vi.fn(),
  verifySellerInvoiceUpload: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: mocks.withTransaction }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/admin/access', () => ({ requirePlatformAdministratorUser: mocks.requireAdmin }))
vi.mock('./payout-runtime', () => ({ readClient: {}, payoutService: {} }))
vi.mock('./payout-repository', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), canManageSeller: mocks.canManageSeller }))
vi.mock('./payout-tax', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), savePayoutTaxProfile: mocks.savePayoutTaxProfile }))
vi.mock('./seller-invoices', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  checkInvoiceableMonth: mocks.checkInvoiceableMonth,
  createSellerInvoice: mocks.createSellerInvoice,
  reviewSellerInvoice: mocks.reviewSellerInvoice,
}))
vi.mock('./seller-invoice-files', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createSellerInvoiceUpload: mocks.createSellerInvoiceUpload,
  verifySellerInvoiceUpload: mocks.verifySellerInvoiceUpload,
}))

import { approveSellerInvoiceAction, rejectSellerInvoiceAction } from './seller-invoice-admin-actions'
import { SellerInvoiceFileError } from './seller-invoice-files'
import { SellerInvoiceError } from './seller-invoices'
import { saveTaxDetailsAction, startSellerInvoiceUploadAction, submitSellerInvoiceAction } from './seller-tax-actions'

const USER = '44444444-4444-4444-8444-444444444444'
const COMPANY = '55555555-5555-4555-8555-555555555555'
const INVOICE = '99999999-9999-4999-8999-999999999999'
const sellerKey = `profile:${USER}`
const fields = { period: '2026-09', documentNumber: ' INV / 42 ', amount: '1,800.00', name: 'invoice.pdf', mimeType: 'application/pdf', size: 2048 }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: USER })
  mocks.requireAdmin.mockResolvedValue({ id: 'admin-1' })
  mocks.canManageSeller.mockResolvedValue(true)
  mocks.withTransaction.mockImplementation(async (work: (tx: unknown) => unknown) => work({}))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('saveTaxDetailsAction', () => {
  it('checks the form first and saves for a seller the member manages, showing only the masked PAN', async () => {
    expect(await saveTaxDetailsAction(sellerKey, { legalName: 'Fixture Seller', pan: '12345', gstRegistered: 'no' }))
      .toMatchObject({ ok: false, fieldErrors: { pan: expect.any(String) } })
    expect(mocks.savePayoutTaxProfile).not.toHaveBeenCalled()

    mocks.savePayoutTaxProfile.mockResolvedValue({ legalName: 'Fixture Seller', maskedPan: 'ABCDE****F', gstRegistered: false, maskedGstin: null, updatedAt: '2026-10-10T00:00:00.000Z' })
    const saved = await saveTaxDetailsAction(sellerKey, { legalName: 'Fixture Seller', pan: 'abcde1234f', gstRegistered: 'no' })
    expect(saved).toMatchObject({ ok: true, message: expect.stringContaining('ABCDE****F') })
    expect(JSON.stringify(saved)).not.toContain('ABCDE1234F')
    expect(mocks.savePayoutTaxProfile).toHaveBeenCalledWith({}, { legalName: 'Fixture Seller', pan: 'ABCDE1234F', gstRegistered: false, gstin: null, seller: { profileId: USER }, actorProfileId: USER })
  })

  it('refuses an organization the member does not own or administer', async () => {
    mocks.canManageSeller.mockResolvedValue(false)
    expect(await saveTaxDetailsAction(`company:${COMPANY}`, { legalName: 'Fixture Org', pan: 'ABCDE1234F', gstRegistered: 'no' }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/only do this for yourself/) })
    expect(mocks.savePayoutTaxProfile).not.toHaveBeenCalled()
  })
})

describe('seller invoice upload', () => {
  it('refuses a wrong amount before handing out an upload URL, naming the exact amount', async () => {
    mocks.checkInvoiceableMonth.mockRejectedValue(new SellerInvoiceError('amount_mismatch', 180_000))
    const result = await startSellerInvoiceUploadAction(sellerKey, { ...fields, amount: '1799' })
    expect(result).toEqual({ ok: false, field: 'amount', error: expect.stringContaining('must be exactly ₹1,800.00') })
    expect(mocks.createSellerInvoiceUpload).not.toHaveBeenCalled()
  })

  it('hands out a presigned upload for a checked month, then records the verified file', async () => {
    mocks.checkInvoiceableMonth.mockResolvedValue({ expectedMinor: 180_000, kind: 'bill_of_supply' })
    mocks.createSellerInvoiceUpload.mockResolvedValue({ uploadUrl: 'https://bucket.example/put', storagePath: 'seller-invoices/profile-x/2026-09/y.pdf', contentType: 'application/pdf', name: 'invoice.pdf' })
    expect(await startSellerInvoiceUploadAction(sellerKey, fields)).toEqual({ ok: true, uploadUrl: 'https://bucket.example/put', storagePath: 'seller-invoices/profile-x/2026-09/y.pdf', contentType: 'application/pdf' })
    expect(mocks.checkInvoiceableMonth).toHaveBeenCalledWith({}, expect.objectContaining({ seller: { profileId: USER }, period: '2026-09', amountMinor: 180_000 }))

    mocks.verifySellerInvoiceUpload.mockResolvedValue({ storagePath: 'seller-invoices/profile-x/2026-09/y.pdf', fileName: 'invoice.pdf', contentType: 'application/pdf', sizeBytes: 2048 })
    const submitted = await submitSellerInvoiceAction(sellerKey, { ...fields, storagePath: 'seller-invoices/profile-x/2026-09/y.pdf' })
    expect(submitted).toMatchObject({ ok: true, message: expect.stringContaining('September 2026') })
    expect(mocks.createSellerInvoice).toHaveBeenCalledWith({}, expect.objectContaining({ documentNumber: 'INV / 42', amountMinor: 180_000, storagePath: 'seller-invoices/profile-x/2026-09/y.pdf', actorProfileId: USER }))
  })

  it('explains a file that is not what it claims to be, and never records it', async () => {
    mocks.verifySellerInvoiceUpload.mockRejectedValue(new SellerInvoiceFileError('This file isn’t really a PDF or image. Upload the original invoice file.'))
    expect(await submitSellerInvoiceAction(sellerKey, { ...fields, storagePath: 'seller-invoices/x' })).toEqual({ ok: false, field: 'file', error: expect.stringMatching(/isn’t really a PDF/) })
    expect(mocks.createSellerInvoice).not.toHaveBeenCalled()
  })

  it('refuses someone who does not manage the seller, and bad input, before touching storage', async () => {
    mocks.canManageSeller.mockResolvedValue(false)
    expect(await startSellerInvoiceUploadAction(`company:${COMPANY}`, fields)).toMatchObject({ ok: false, error: expect.stringMatching(/only do this/) })
    expect(await startSellerInvoiceUploadAction(sellerKey, { ...fields, period: '2026-13' })).toMatchObject({ ok: false })
    expect(await startSellerInvoiceUploadAction(sellerKey, { ...fields, documentNumber: '' })).toMatchObject({ ok: false, field: 'documentNumber' })
    expect(await startSellerInvoiceUploadAction(sellerKey, { ...fields, amount: 'lots' })).toMatchObject({ ok: false, field: 'amount' })
    expect(mocks.createSellerInvoiceUpload).not.toHaveBeenCalled()
  })
})

describe('admin invoice review', () => {
  it('approves and rejects (with a note) for platform administrators only', async () => {
    mocks.reviewSellerInvoice.mockResolvedValue({ period: '2026-09' })
    expect(await approveSellerInvoiceAction(INVOICE)).toEqual({ ok: true, message: 'Approved. The course earnings for September 2026 can now be paid out.' })
    expect(mocks.reviewSellerInvoice).toHaveBeenCalledWith({}, { invoiceId: INVOICE, decision: 'approve', note: null, actorProfileId: 'admin-1' })

    expect(await rejectSellerInvoiceAction(INVOICE, ' ')).toMatchObject({ ok: false, error: expect.stringMatching(/what to fix/) })
    expect(await rejectSellerInvoiceAction(INVOICE, 'The bill is not signed.')).toMatchObject({ ok: true })
    expect(mocks.reviewSellerInvoice).toHaveBeenLastCalledWith({}, { invoiceId: INVOICE, decision: 'reject', note: 'The bill is not signed.', actorProfileId: 'admin-1' })

    mocks.requireAdmin.mockRejectedValue(new Error('admin_forbidden'))
    expect(await approveSellerInvoiceAction(INVOICE)).toEqual({ ok: false, error: 'Only Sea N Shore platform administrators can do this.' })
  })

  it('explains an invoice whose month changed since it was sent', async () => {
    mocks.reviewSellerInvoice.mockRejectedValue(new SellerInvoiceError('amount_changed', 45_000))
    expect(await approveSellerInvoiceAction(INVOICE)).toMatchObject({ ok: false, error: expect.stringContaining('now ₹450.00') })
    expect(await approveSellerInvoiceAction('not-a-uuid')).toMatchObject({ ok: false })
  })
})
