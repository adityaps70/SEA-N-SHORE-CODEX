import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const USER = '44444444-4444-4444-8444-444444444444'
const COMPANY = '55555555-5555-4555-8555-555555555555'

const mocks = vi.hoisted(() => ({
  configured: true,
  release: vi.fn(async () => 0),
  sellerSeen: [] as unknown[],
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
  }],
}))

import EarningsPage from './page'

beforeEach(() => {
  mocks.configured = true
  mocks.sellerSeen = []
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
})
