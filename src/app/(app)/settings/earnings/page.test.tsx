import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const USER = '44444444-4444-4444-8444-444444444444'
const COMPANY = '55555555-5555-4555-8555-555555555555'

const mocks = vi.hoisted(() => ({
  configured: true,
  release: vi.fn(async () => 0),
  sellerSeen: [] as unknown[],
  taxProfile: null as unknown,
  invoiceMonths: [] as unknown[],
  extraPayouts: [] as unknown[],
}))

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: async (work: (tx: unknown) => unknown) => work({}) }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: async () => ({ id: USER, cognitoSub: 's', email: null }) }))
vi.mock('@/features/payouts/payout-runtime', () => ({ arePayoutsConfigured: async () => mocks.configured, readClient: {} }))
vi.mock('@/features/payments/earnings', () => ({
  releaseAvailableEarnings: mocks.release,
  getPlatformFeeSettings: async () => ({ defaultPercent: '10.00', holdDays: 7 }),
  getSellerBalance: async (seller: unknown) => {
    mocks.sellerSeen.push(seller)
    return [{ currency: 'INR', pendingMinor: 44910, availableMinor: 17964, inPayoutMinor: 0, paidMinor: 89820, nextAvailableAt: '2026-10-05T10:00:00.000Z' }]
  },
}))
vi.mock('@/features/payouts/payout-repository', () => ({
  listManagedOrganizations: async () => [{ id: COMPANY, name: 'Blue Anchor Shipping', slug: 'blue-anchor', role: 'administrator' }],
  getActivePayoutAccount: async () => null,
  getPayoutSettings: async () => ({ minPayoutMinor: 10000 }),
}))
vi.mock('@/features/payouts/payout-queries', () => ({
  getSellerFeePercent: async () => null,
  listSellerEarnings: async () => ({
    hasMore: false,
    lines: [
      { id: 'e1', sourceType: 'event_ticket', baseSourceType: 'event_ticket', title: 'Tanker Safety Workshop', soldAt: '2026-09-20T10:00:00.000Z', currency: 'INR', grossMinor: 49900, feePercent: '10.00', feeMinor: 4990, netMinor: 44910, status: 'pending', availableAt: '2026-10-05T10:00:00.000Z', payoutId: null, note: null },
      { id: 'e2', sourceType: 'adjustment', baseSourceType: 'event_ticket', title: 'Bridge Resource Management', soldAt: '2026-09-18T10:00:00.000Z', currency: 'INR', grossMinor: -19960, feePercent: '10.00', feeMinor: -1996, netMinor: -17964, status: 'available', availableAt: '2026-09-18T10:00:00.000Z', payoutId: null, note: 'Refunded' },
    ],
  }),
  listSellerPayouts: async () => [{
    id: 'p1', seller: { profileId: USER }, amountMinor: 89820, currency: 'INR', status: 'success', utr: 'N123456789', createdAt: '2026-09-10T10:00:00.000Z',
    account: { method: 'bank', summary: 'Bank account ••••1772 · HDFC0000001', holderName: 'Arjun Rao', ifsc: 'HDFC0000001', last4: '1772', maskedVpa: null },
    sellerIdentity: { seller: { profileId: USER }, name: 'Arjun Rao', slug: 'arjun', kind: 'profile' },
  }, ...mocks.extraPayouts],
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/features/payouts/seller-tax-actions', () => ({ startSellerInvoiceUploadAction: vi.fn(), submitSellerInvoiceAction: vi.fn(), saveTaxDetailsAction: vi.fn() }))
vi.mock('@/features/payouts/payout-tax', () => ({ getPayoutTaxProfile: async () => mocks.taxProfile }))
vi.mock('@/features/payouts/seller-invoices', () => ({ listSellerInvoiceMonths: async () => mocks.invoiceMonths }))

import EarningsPage from './page'

beforeEach(() => {
  mocks.configured = true
  mocks.sellerSeen = []
  mocks.taxProfile = null
  mocks.invoiceMonths = []
  mocks.extraPayouts = []
  vi.clearAllMocks()
})
afterEach(() => cleanup())

describe('Settings → Earnings', () => {
  it('releases finished holds, then shows balances, sales with fee and net, and payouts with UTR', async () => {
    render(await EarningsPage({ searchParams: Promise.resolve({}) }))
    expect(mocks.release).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: 'Earnings' })).toBeInTheDocument()
    expect(screen.getByText('On hold').closest('div')).toHaveTextContent('₹449.10')
    expect(screen.getByText('On hold').closest('div')).toHaveTextContent('Next release 5 Oct 2026')
    expect(screen.getByText('Ready for payout').closest('div')).toHaveTextContent('₹179.64')
    expect(screen.getByText('Paid out').closest('div')).toHaveTextContent('₹898.20')
    const sale = screen.getByText('Tanker Safety Workshop').closest('li') as HTMLElement
    expect(within(sale).getByText('₹499.00')).toBeInTheDocument()
    expect(within(sale).getByText('(10%)')).toBeInTheDocument()
    expect(within(sale).getByText('₹449.10')).toBeInTheDocument()
    expect(within(sale).getByText('On hold until 5 Oct 2026')).toBeInTheDocument()
    const refund = screen.getByText('Bridge Resource Management').closest('li') as HTMLElement
    expect(within(refund).getByText('−₹179.64')).toBeInTheDocument()
    expect(within(refund).getByText('Deducted next payout')).toBeInTheDocument()
    expect(screen.getByText('N123456789')).toBeInTheDocument()
    expect(screen.getByText(/Add payout details to get paid/)).toBeInTheDocument()
    expect(mocks.sellerSeen).toEqual([{ profileId: USER }])
  })

  it('switches to an organization the member administers, and ignores ones they do not', async () => {
    render(await EarningsPage({ searchParams: Promise.resolve({ for: `company:${COMPANY}` }) }))
    expect(screen.getByRole('heading', { name: 'Earnings · Blue Anchor Shipping' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Blue Anchor Shipping' })).toHaveAttribute('aria-current', 'page')
    expect(mocks.sellerSeen).toEqual([{ companyId: COMPANY }])
    cleanup()
    render(await EarningsPage({ searchParams: Promise.resolve({ for: 'company:99999999-9999-4999-8999-999999999999' }) }))
    expect(mocks.sellerSeen.at(-1)).toEqual({ profileId: USER })
  })

  it('says when payouts are not switched on', async () => {
    mocks.configured = false
    render(await EarningsPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText(/Payouts are not switched on yet/)).toBeInTheDocument()
  })

  it('shows each month of course earnings with the amount to invoice and its status, and TDS on course payouts (C4)', async () => {
    mocks.taxProfile = { legalName: 'Fixture Seller', pan: 'ABCDE1234F', gstRegistered: false, gstin: null, updatedAt: '2026-09-01T10:00:00.000Z' }
    mocks.invoiceMonths = [
      { period: '2026-10', expectedMinor: 90000, state: 'open', invoice: null },
      { period: '2026-09', expectedMinor: 180000, state: 'due', invoice: null },
      {
        period: '2026-08', expectedMinor: 120000, state: 'rejected',
        invoice: { id: '99999999-9999-4999-8999-999999999999', kind: 'bill_of_supply', documentNumber: 'B-7', amountMinor: 120000, fileName: 'bill.pdf', status: 'rejected', reviewNote: 'The bill is not signed.', reviewedAt: '2026-09-03T10:00:00.000Z', createdAt: '2026-09-02T10:00:00.000Z' },
      },
      { period: '2026-07', expectedMinor: -5000, state: 'not_needed', invoice: null },
    ]
    mocks.extraPayouts = [{
      id: 'p2', seller: { profileId: USER }, amountMinor: 162000, grossMinor: 180000, tdsBaseMinor: 180000, tdsMinor: 18000, tdsSection: '194J', tdsRateBasisPoints: 1000, tdsFinancialYear: '2026-27',
      currency: 'INR', status: 'success', utr: 'N999', createdAt: '2026-09-20T10:00:00.000Z', account: null,
      sellerIdentity: { seller: { profileId: USER }, name: 'Arjun Rao', slug: 'arjun', kind: 'profile' },
    }]
    render(await EarningsPage({ searchParams: Promise.resolve({}) }))
    const section = screen.getByRole('region', { name: 'Monthly invoices for course earnings' })
    expect(section).toHaveTextContent('upload a bill of supply (no GST)')
    const september = within(section).getByText('September 2026').closest('li') as HTMLElement
    expect(within(september).getByText('₹1,800.00')).toBeInTheDocument()
    expect(within(september).getByText('Invoice needed')).toBeInTheDocument()
    expect(within(september).getByRole('button', { name: 'Upload invoice' })).toBeInTheDocument()
    const august = within(section).getByText('August 2026').closest('li') as HTMLElement
    expect(august).toHaveTextContent('The bill is not signed.')
    expect(within(august).getByRole('link', { name: 'bill.pdf' })).toHaveAttribute('href', '/api/payouts/seller-invoices/99999999-9999-4999-8999-999999999999')
    expect(within(august).getByRole('button', { name: 'Upload a new invoice' })).toBeInTheDocument()
    const october = within(section).getByText('October 2026').closest('li') as HTMLElement
    expect(within(october).getByText('Month in progress')).toBeInTheDocument()
    expect(within(october).queryByRole('button')).not.toBeInTheDocument()
    expect(within(section).getByText('July 2026').closest('li')).toHaveTextContent('No invoice needed')
    // The payout shows gross, TDS (section and rate) and net; the PAN never reaches the page.
    const payout = screen.getByText('N999').closest('li') as HTMLElement
    expect(payout).toHaveTextContent('Earnings ₹1,800.00 − TDS ₹180.00 (section 194J, 10%, on ₹1,800.00 of course earnings) = paid ₹1,620.00')
    expect(document.body.textContent).not.toContain('ABCDE1234F')
  })

  it('asks for tax details before course invoices can be uploaded', async () => {
    mocks.invoiceMonths = [{ period: '2026-09', expectedMinor: 180000, state: 'due', invoice: null }]
    render(await EarningsPage({ searchParams: Promise.resolve({}) }))
    const section = screen.getByRole('region', { name: 'Monthly invoices for course earnings' })
    expect(within(section).getByText(/Add tax details first/)).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'Add tax details' })).toHaveAttribute('href', '/settings/payouts')
    expect(within(section).queryByRole('button', { name: 'Upload invoice' })).not.toBeInTheDocument()
  })
})
