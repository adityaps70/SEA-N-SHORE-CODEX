import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))

import { adminPayoutErrorMessage } from './payout-messages'
import { PayoutError } from './payout-repository'
import { maskGstin, maskTaxProfile, parseTaxProfileInput } from './payout-tax'
import {
  buildSellerInvoicePath,
  checkSellerInvoiceFile,
  isClosedPeriod,
  isSellerInvoicePath,
  listPeriods,
  periodLabel,
  previousMonth,
  SELLER_INVOICE_MAX_BYTES,
} from './seller-invoice-rules'
import { monthState } from './seller-invoices'

const PROFILE = { profileId: '44444444-4444-4444-8444-444444444444' }
const COMPANY = { companyId: '55555555-5555-4555-8555-555555555555' }
const FILE_ID = '0b5c1d6e-1111-4222-8333-444455556666'

describe('seller invoice paths', () => {
  it('builds a private path per seller and month, and accepts only that path back', () => {
    const path = buildSellerInvoicePath({ seller: PROFILE, period: '2026-09', fileId: FILE_ID, contentType: 'application/pdf' })
    expect(path).toBe(`seller-invoices/profile-${PROFILE.profileId}/2026-09/${FILE_ID}.pdf`)
    expect(isSellerInvoicePath(path, { seller: PROFILE, period: '2026-09', contentType: 'application/pdf' })).toBe(true)
    expect(isSellerInvoicePath(path, { seller: PROFILE, period: '2026-08', contentType: 'application/pdf' })).toBe(false)
    expect(isSellerInvoicePath(path, { seller: COMPANY, period: '2026-09', contentType: 'application/pdf' })).toBe(false)
    expect(isSellerInvoicePath(path, { seller: PROFILE, period: '2026-09', contentType: 'image/png' })).toBe(false)
    expect(isSellerInvoicePath(`${path}.exe`, { seller: PROFILE, period: '2026-09', contentType: 'application/pdf' })).toBe(false)
    expect(isSellerInvoicePath(`seller-invoices/profile-${PROFILE.profileId}/2026-09/../x.pdf`, { seller: PROFILE, period: '2026-09', contentType: 'application/pdf' })).toBe(false)
    expect(buildSellerInvoicePath({ seller: COMPANY, period: '2026-09', fileId: FILE_ID, contentType: 'image/jpeg' })).toMatch(/^seller-invoices\/company-55555555-5555-4555-8555-555555555555\/2026-09\/.+\.jpg$/)
  })

  it('accepts PDF, JPG, PNG and WebP up to 10 MB', () => {
    expect(checkSellerInvoiceFile({ name: 'inv.pdf', mimeType: 'application/pdf', size: 2048 })).toEqual({ ok: true, contentType: 'application/pdf', name: 'inv.pdf' })
    expect(checkSellerInvoiceFile({ name: 'inv.gif', mimeType: 'image/gif', size: 2048 })).toMatchObject({ ok: false, error: expect.stringMatching(/PDF, JPG, PNG or WebP/) })
    expect(checkSellerInvoiceFile({ name: 'inv.pdf', mimeType: 'application/pdf', size: SELLER_INVOICE_MAX_BYTES + 1 })).toMatchObject({ ok: false, error: expect.stringMatching(/10 MB/) })
    expect(checkSellerInvoiceFile({ name: 'inv.pdf', mimeType: 'application/pdf', size: 0 })).toMatchObject({ ok: false })
  })
})

describe('periods', () => {
  it('labels, lists and closes months in India time', () => {
    expect(periodLabel('2026-09')).toBe('September 2026')
    expect(listPeriods(['2026-08', '2026-09'])).toBe('August 2026 and September 2026')
    expect(listPeriods(['2026-07', '2026-08', '2026-09'])).toBe('July 2026, August 2026 and September 2026')
    expect(isClosedPeriod('2026-09', '2026-10')).toBe(true)
    expect(isClosedPeriod('2026-10', '2026-10')).toBe(false)
    expect(previousMonth('2026-01')).toBe('2025-12')
    expect(previousMonth('2026-10')).toBe('2026-09')
  })

  it('works out what each month needs', () => {
    expect(monthState({ period: '2026-09', expectedMinor: 100, invoiceStatus: null, currentMonth: '2026-10' })).toBe('due')
    expect(monthState({ period: '2026-10', expectedMinor: 100, invoiceStatus: null, currentMonth: '2026-10' })).toBe('open')
    expect(monthState({ period: '2026-09', expectedMinor: 0, invoiceStatus: null, currentMonth: '2026-10' })).toBe('not_needed')
    expect(monthState({ period: '2026-09', expectedMinor: 100, invoiceStatus: 'rejected', currentMonth: '2026-10' })).toBe('rejected')
    expect(monthState({ period: '2026-09', expectedMinor: 100, invoiceStatus: 'submitted', currentMonth: '2026-10' })).toBe('submitted')
    expect(monthState({ period: '2026-09', expectedMinor: 90, invoiceStatus: 'approved', currentMonth: '2026-10' })).toBe('approved')
  })
})

describe('admin messages for the course payout gate', () => {
  it('names the months without an approved invoice, and the missing PAN or TDS rate', () => {
    expect(adminPayoutErrorMessage(new PayoutError('invoice_missing', ['2026-08', '2026-09'])))
      .toMatch(/course earnings for August 2026 and September 2026 can't be paid until their invoice for those months is approved\. Nothing was sent\./)
    expect(adminPayoutErrorMessage(new PayoutError('pan_missing'))).toMatch(/hasn't added their PAN yet/)
    expect(adminPayoutErrorMessage(new PayoutError('tds_rate_unset'))).toMatch(/TDS rate for course payouts is not set yet/)
  })
})

describe('tax details form', () => {
  it('normalises the PAN and GSTIN, and checks the GSTIN belongs to the PAN', () => {
    expect(parseTaxProfileInput({ legalName: '  Fixture   Seller ', pan: 'abcde 1234f', gstRegistered: 'no', gstin: 'ignored' }))
      .toEqual({ ok: true, input: { legalName: 'Fixture Seller', pan: 'ABCDE1234F', gstRegistered: false, gstin: null } })
    // Sea N Shore's own GSTIN is a valid one whose PAN is AASFB2030K.
    expect(parseTaxProfileInput({ legalName: 'Fixture Seller', pan: 'AASFB2030K', gstRegistered: 'yes', gstin: '27aasfb2030k1ze' }))
      .toEqual({ ok: true, input: { legalName: 'Fixture Seller', pan: 'AASFB2030K', gstRegistered: true, gstin: '27AASFB2030K1ZE' } })
    expect(parseTaxProfileInput({ legalName: 'Fixture Seller', pan: 'ABCDE1234F', gstRegistered: 'yes', gstin: '27AASFB2030K1ZE' }))
      .toMatchObject({ ok: false, fieldErrors: { gstin: expect.stringMatching(/different PAN/) } })
    expect(parseTaxProfileInput({ legalName: 'Fixture Seller', pan: 'AASFB2030K', gstRegistered: 'yes', gstin: '27AASFB2030K1ZA' }))
      .toMatchObject({ ok: false, fieldErrors: { gstin: expect.stringMatching(/valid 15-character GSTIN/) } })
    expect(parseTaxProfileInput({ legalName: 'X', pan: '1234', gstRegistered: '' }))
      .toMatchObject({ ok: false, fieldErrors: { legalName: expect.any(String), pan: expect.any(String), gstRegistered: expect.any(String) } })
  })

  it('masks the PAN and the PAN inside the GSTIN', () => {
    expect(maskGstin('27AASFB2030K1ZE')).toBe('27AASFB****K1ZE')
    const masked = maskTaxProfile({ legalName: 'Fixture Seller', pan: 'ABCDE1234F', gstRegistered: true, gstin: '27ABCDE1234F1Z5', updatedAt: '2026-09-01T00:00:00.000Z' })
    expect(masked).toEqual({ legalName: 'Fixture Seller', gstRegistered: true, maskedPan: 'ABCDE****F', maskedGstin: '27ABCDE****F1Z5', updatedAt: '2026-09-01T00:00:00.000Z' })
    expect(JSON.stringify(masked)).not.toContain('1234F')
  })
})
