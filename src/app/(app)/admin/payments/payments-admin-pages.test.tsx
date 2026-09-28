import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const USER = '44444444-4444-4444-8444-444444444444'
const COMPANY = '55555555-5555-4555-8555-555555555555'
const E1 = 'e1111111-1111-4111-8111-111111111111'

const mocks = vi.hoisted(() => ({
  admin: true,
  configured: true,
  queue: [] as unknown[],
  lines: [] as unknown[],
  account: null as unknown,
  open: null as unknown,
  payments: [] as unknown[],
  release: vi.fn(async () => 0),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/admin/payments' }))
vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: async (work: (tx: unknown) => unknown) => work({}) }))
vi.mock('@/features/admin/access', () => ({
  requirePlatformAdministratorUser: async () => {
    if (!mocks.admin) throw new Error('admin_forbidden')
    return { id: 'admin-1', cognitoSub: 'a', email: null }
  },
}))
vi.mock('@/features/payouts/admin-actions', () => ({
  sendPayoutAction: vi.fn(), refreshPayoutStatusAction: vi.fn(), retryPayoutAction: vi.fn(), cancelPayoutAction: vi.fn(),
  updateFeeSettingsAction: vi.fn(), searchSellersAction: vi.fn(), setFeeOverrideAction: vi.fn(), removeFeeOverrideAction: vi.fn(),
}))
vi.mock('@/features/payments/earnings', () => ({ releaseAvailableEarnings: mocks.release, getPlatformFeeSettings: async () => ({ defaultPercent: '10.00', holdDays: 7 }) }))
vi.mock('@/features/payments/provider', () => ({ getPaymentCapabilities: async () => ({ configured: true, provider: 'cashfree', currencies: ['INR'] }) }))
vi.mock('@/features/payouts/payout-runtime', () => ({
  readClient: {},
  arePayoutsConfigured: async () => mocks.configured,
  payoutsEnvironment: async () => (mocks.configured ? 'sandbox' : null),
}))
vi.mock('@/features/payouts/payout-repository', () => ({
  getPayoutSettings: async () => ({ minPayoutMinor: 10000 }),
  getActivePayoutAccount: async () => mocks.account,
  findOpenPayout: async () => mocks.open,
}))
vi.mock('@/features/payouts/payout-queries', () => ({
  getPaymentsOverview: async () => ({
    unavailable: ['course', 'plan'],
    collected: [{ type: 'event', currency: 'INR', payments: 3, collectedMinor: 149700, refundedMinor: 49900 }],
    ledger: [{ currency: 'INR', feesMinor: 9980, availableMinor: 44910, pendingMinor: 44910, inPayoutMinor: 0, paidMinor: 0 }],
    payouts: { paidOutMinor: 0, paidOutCount: 0, openCount: 1, unconfirmedCount: 1, failedCount: 0 },
  }),
  listPayoutQueue: async () => mocks.queue,
  listPayouts: async () => [],
  listFeeOverrides: async () => [],
  getSellerIdentity: async () => ({ seller: { profileId: USER }, name: 'Arjun Rao', slug: 'arjun', kind: 'profile' }),
  listPayableEarningLines: async () => mocks.lines,
  listRecentPayments: async () => ({ lines: mocks.payments, unavailable: [] }),
  PAYMENT_TYPES: ['event', 'course', 'plan'],
  PAYMENT_STATUSES: ['paid', 'pending', 'failed', 'refunded', 'cancelled'],
}))

import AdminPaymentsOverviewPage from './page'
import AdminPaymentFeesPage from './fees/page'
import AdminPayoutsQueuePage from './payouts/page'
import ReviewPayoutPage from './payouts/review/page'
import AdminPaymentsListPage from './transactions/page'

const bankAccount = {
  id: 'a', seller: { profileId: USER }, method: 'bank', holderName: 'Arjun Rao', ifsc: 'HDFC0000001', last4: '1772', vpa: null,
  providerBeneficiaryId: 'snsb_x', providerStatus: 'VERIFIED', providerVerified: true, status: 'active', createdAt: '2026-09-01T10:00:00.000Z',
}

function queueLine(overrides: Record<string, unknown> = {}) {
  return {
    sellerIdentity: { seller: { profileId: USER }, name: 'Arjun Rao', slug: 'arjun', kind: 'profile' },
    currency: 'INR', availableMinor: 62874, earningCount: 2,
    account: { ...bankAccount, masked: { method: 'bank', holderName: 'Arjun Rao', summary: 'Bank account ••••1772 · HDFC0000001', ifsc: 'HDFC0000001', last4: '1772', maskedVpa: null } },
    openPayout: null,
    ...overrides,
  }
}

beforeEach(() => {
  mocks.admin = true
  mocks.configured = true
  mocks.queue = []
  mocks.lines = []
  mocks.account = null
  mocks.open = null
  mocks.payments = []
  vi.clearAllMocks()
})
afterEach(() => cleanup())

describe('Admin → Payments', () => {
  it('is hidden (404) from anyone who is not a platform administrator', async () => {
    mocks.admin = false
    await expect(AdminPaymentsOverviewPage()).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(AdminPayoutsQueuePage()).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(AdminPaymentFeesPage()).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(ReviewPayoutPage({ searchParams: Promise.resolve({ seller: `profile:${USER}` }) })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('overview shows collected money by type, fees and what is owed', async () => {
    render(await AdminPaymentsOverviewPage())
    const events = screen.getByText('Event tickets').closest('li') as HTMLElement
    expect(within(events).getByText('₹1,497.00')).toBeInTheDocument()
    expect(within(events).getByText('₹499.00')).toBeInTheDocument()
    expect(within(events).getByText('₹998.00')).toBeInTheDocument()
    expect(screen.getByText('Platform fees earned').closest('div')).toHaveTextContent('₹99.80')
    expect(screen.getByText('Sandbox (test money)')).toBeInTheDocument()
    expect(screen.getByText(/1 payout was not confirmed by Cashfree/)).toBeInTheDocument()
  })

  it('queue offers "Create payout" only when a payout can actually be sent', async () => {
    mocks.queue = [
      queueLine(),
      queueLine({ sellerIdentity: { seller: { companyId: COMPANY }, name: 'Blue Anchor Shipping', slug: 'blue-anchor', kind: 'organization' }, account: null }),
      queueLine({ sellerIdentity: { seller: { profileId: '66666666-6666-4666-8666-666666666666' }, name: 'Nisha Menon', slug: null, kind: 'profile' }, availableMinor: 5000 }),
      queueLine({ sellerIdentity: { seller: { profileId: '77777777-7777-4777-8777-777777777777' }, name: 'Rahul Verma', slug: null, kind: 'profile' }, availableMinor: -4491 }),
    ]
    render(await AdminPayoutsQueuePage())
    expect(mocks.release).toHaveBeenCalled()
    expect(screen.getAllByRole('link', { name: 'Create payout' })).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Create payout' })).toHaveAttribute('href', `/admin/payments/payouts/review?seller=${encodeURIComponent(`profile:${USER}`)}`)
    expect(screen.getByText('Waiting for payout details')).toBeInTheDocument()
    expect(screen.getByText('Below the ₹100.00 minimum')).toBeInTheDocument()
    expect(screen.getByText(/Owes ₹44.91 from refunds/)).toBeInTheDocument()
  })

  it('links a person seller in the payout queue to their public profile at /people/<slug>', async () => {
    mocks.queue = [queueLine()]
    render(await AdminPayoutsQueuePage())
    expect(screen.getByRole('link', { name: 'Arjun Rao' })).toHaveAttribute('href', '/people/arjun')
  })

  it('transactions link the payer to /people/<slug> (there is no /profile/<slug> page)', async () => {
    mocks.payments = [
      { type: 'event', id: 'o-1', occurredAt: '2026-09-01T10:00:00.000Z', amountMinor: 49900, currency: 'INR', status: 'paid', provider: 'cashfree', reference: 'cf_1', title: 'Tanker Safety Workshop', payerName: 'Arjun Rao', payerSlug: 'arjun' },
      { type: 'course', id: 'o-2', occurredAt: '2026-09-02T10:00:00.000Z', amountMinor: 19960, currency: 'INR', status: 'paid', provider: 'razorpay', reference: null, title: 'ECDIS Refresher', payerName: 'Former member', payerSlug: null },
    ]
    render(await AdminPaymentsListPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByRole('link', { name: 'Arjun Rao' })).toHaveAttribute('href', '/people/arjun')
    expect(screen.getByText(/Former member/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Former member' })).not.toBeInTheDocument()
    expect(document.querySelector('a[href^="/profile/"]')).toBeNull()
  })

  it('queue explains when Cashfree Payouts is not set up', async () => {
    mocks.configured = false
    mocks.queue = [queueLine()]
    render(await AdminPayoutsQueuePage())
    expect(screen.getByText(/Cashfree Payouts is not set up\./)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Create payout' })).not.toBeInTheDocument()
  })

  it('review lists every included earning and offers "Send ₹X via Cashfree"', async () => {
    mocks.account = bankAccount
    mocks.lines = [
      { id: E1, sourceType: 'event_ticket', baseSourceType: 'event_ticket', title: 'Tanker Safety Workshop', soldAt: '2026-09-01T10:00:00.000Z', currency: 'INR', grossMinor: 49900, feePercent: '10.00', feeMinor: 4990, netMinor: 44910, status: 'available', availableAt: '2026-09-08T10:00:00.000Z', payoutId: null, note: null },
      { id: 'e2', sourceType: 'course_purchase', baseSourceType: 'course_purchase', title: 'ECDIS Refresher', soldAt: '2026-09-02T10:00:00.000Z', currency: 'INR', grossMinor: 19960, feePercent: '10.00', feeMinor: 1996, netMinor: 17964, status: 'available', availableAt: '2026-09-09T10:00:00.000Z', payoutId: null, note: null },
    ]
    render(await ReviewPayoutPage({ searchParams: Promise.resolve({ seller: `profile:${USER}` }) }))
    expect(screen.getByRole('heading', { name: 'Payout to Arjun Rao' })).toBeInTheDocument()
    expect(screen.getByText('Tanker Safety Workshop')).toBeInTheDocument()
    expect(screen.getByText('ECDIS Refresher')).toBeInTheDocument()
    expect(screen.getByText('Total').closest('p')).toHaveTextContent('₹628.74')
    expect(screen.getByRole('button', { name: 'Send ₹628.74 via Cashfree' })).toBeInTheDocument()
  })

  it('review explains why a payout cannot be sent', async () => {
    mocks.lines = [{ id: E1, sourceType: 'event_ticket', baseSourceType: 'event_ticket', title: 'Workshop', soldAt: '2026-09-01T10:00:00.000Z', currency: 'INR', grossMinor: 49900, feePercent: '10.00', feeMinor: 4990, netMinor: 44910, status: 'available', availableAt: '2026-09-08T10:00:00.000Z', payoutId: null, note: null }]
    render(await ReviewPayoutPage({ searchParams: Promise.resolve({ seller: `profile:${USER}` }) }))
    expect(screen.getByText(/hasn't added payout details yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /via Cashfree/ })).not.toBeInTheDocument()
    await expect(ReviewPayoutPage({ searchParams: Promise.resolve({ seller: 'bogus' }) })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
