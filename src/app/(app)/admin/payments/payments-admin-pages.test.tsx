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
  awaiting: [] as unknown[],
  tdsRate: 1000 as number | null,
  taxPlan: null as unknown,
  invoices: { submitted: [] as unknown[], reviewed: [] as unknown[] },
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
vi.mock('@/features/payments/payments-health', () => ({
  getPaymentsHealth: async () => ({
    allOk: false,
    lines: [
      { id: 'payouts_keys', label: 'Payouts keys', tone: 'ok', value: 'Present · PROD', detail: null },
      { id: 'payouts_auth', label: 'Payouts authentication', tone: 'problem', value: 'IP whitelist (no public key)', detail: "Our web servers have no fixed address, so an IP whitelist can't work." },
    ],
  }),
}))
vi.mock('@/features/payouts/admin-actions', () => ({
  checkCashfreeConnectionAction: vi.fn(),
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
  listAwaitingInvoiceLines: async () => mocks.awaiting,
  listRecentPayments: async () => ({ lines: mocks.payments, unavailable: [] }),
  PAYMENT_TYPES: ['event', 'course', 'plan'],
  PAYMENT_STATUSES: ['paid', 'pending', 'failed', 'refunded', 'cancelled'],
}))

vi.mock('@/features/tax/tax-settings', () => ({
  getTaxSettings: async () => ({ tdsSection: '194J', tdsRateBasisPoints: mocks.tdsRate, tdsThresholdMinor: null, updatedAt: null }),
}))
vi.mock('@/features/payouts/payout-tax', () => ({
  planPayoutTax: async (_client: unknown, input: { grossMinor: number; coursePartMinor: number }) => mocks.taxPlan ?? {
    grossMinor: input.grossMinor, coursePartMinor: input.coursePartMinor, applies: false, blocker: null, section: null, rateBasisPoints: null,
    thresholdMinor: null, financialYear: null, pan: null, tds: null, tdsMinor: 0, netMinor: input.grossMinor,
  },
}))
vi.mock('@/features/payouts/seller-invoices', () => ({
  listSellerInvoicesForReview: async (_client: unknown, options: { status: 'submitted' | 'reviewed' }) => mocks.invoices[options.status],
}))
vi.mock('@/features/payouts/seller-invoice-admin-actions', () => ({ approveSellerInvoiceAction: vi.fn(), rejectSellerInvoiceAction: vi.fn() }))

import AdminPaymentsOverviewPage from './page'
import AdminPaymentFeesPage from './fees/page'
import AdminPayoutsQueuePage from './payouts/page'
import ReviewPayoutPage from './payouts/review/page'
import AdminPaymentsListPage from './transactions/page'
import AdminSellerInvoicesPage from './seller-invoices/page'

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
  mocks.awaiting = []
  mocks.tdsRate = 1000
  mocks.taxPlan = null
  mocks.invoices = { submitted: [], reviewed: [] }
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

  it('overview shows the Payments health card with status only (hotfix P1)', async () => {
    render(await AdminPaymentsOverviewPage())
    const card = screen.getByRole('region', { name: /Payments health/ })
    expect(within(card).getByText('Needs attention')).toBeInTheDocument()
    expect(within(card).getByTestId('payments-health-payouts_auth')).toHaveTextContent('Needs attention: IP whitelist (no public key)')
    expect(within(card).getByTestId('payments-health-payouts_keys')).toHaveTextContent('OK: Present · PROD')
    expect(within(card).getByRole('button', { name: 'Check Cashfree now' })).toBeInTheDocument()
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

describe('Admin → Payments: course invoices and TDS (C4)', () => {
  const courseLine = { id: 'e2', sourceType: 'course_purchase', baseSourceType: 'course_purchase', title: 'ECDIS Refresher', soldAt: '2026-08-02T10:00:00.000Z', currency: 'INR', grossMinor: 200000, feePercent: '10.00', feeMinor: 20000, netMinor: 180000, status: 'available', availableAt: '2026-08-09T10:00:00.000Z', payoutId: null, note: null, period: '2026-08' }

  it('queue says why a seller cannot be paid yet: no approved invoice, no PAN, no TDS rate', async () => {
    mocks.queue = [
      queueLine({ availableMinor: 0, earningCount: 0, courseMinor: 0, awaitingInvoiceMinor: 180000, awaitingPeriods: ['2026-08', '2026-09'], hasTaxProfile: true }),
      queueLine({ sellerIdentity: { seller: { companyId: COMPANY }, name: 'Blue Anchor Shipping', slug: 'blue-anchor', kind: 'organization' }, courseMinor: 62874, hasTaxProfile: false }),
    ]
    render(await AdminPayoutsQueuePage())
    expect(screen.getByText('No approved invoice for August 2026 and September 2026')).toBeInTheDocument()
    expect(screen.getByText(/Not included: ₹1,800.00 of course earnings waiting for the seller's invoice for August 2026 and September 2026/)).toBeInTheDocument()
    expect(screen.getByText("Waiting for the seller's PAN")).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Create payout' })).not.toBeInTheDocument()
    cleanup()
    mocks.tdsRate = null
    mocks.queue = [queueLine({ courseMinor: 62874, hasTaxProfile: true })]
    render(await AdminPayoutsQueuePage())
    expect(screen.getByText(/TDS rate not set/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Create payout' })).not.toBeInTheDocument()
  })

  it('review shows gross, TDS and net, and sends the net amount', async () => {
    mocks.account = bankAccount
    mocks.lines = [courseLine]
    mocks.taxPlan = {
      grossMinor: 180000, coursePartMinor: 180000, applies: true, blocker: null, section: '194J', rateBasisPoints: 1000, thresholdMinor: null,
      financialYear: '2026-27', pan: 'ABCDE1234F', tds: { tdsBaseMinor: 180000, fyGrossMinor: 180000, thresholdCrossed: true, targetMinor: 18000, tdsMinor: 18000 },
      tdsMinor: 18000, netMinor: 162000,
    }
    render(await ReviewPayoutPage({ searchParams: Promise.resolve({ seller: `profile:${USER}` }) }))
    expect(screen.getByRole('heading', { name: 'TDS on course earnings' })).toBeInTheDocument()
    expect(screen.getByText('TDS deducted').closest('div')).toHaveTextContent('₹180.00')
    expect(screen.getByText('Net transferred').closest('div')).toHaveTextContent('₹1,620.00')
    expect(screen.getByText(/Section 194J at 10%, from the first rupee/)).toBeInTheDocument()
    expect(screen.queryByText('ABCDE1234F')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send ₹1,620.00 via Cashfree' })).toBeInTheDocument()
  })

  it('review refuses while the PAN or TDS rate is missing, or the month has no approved invoice', async () => {
    mocks.account = bankAccount
    mocks.lines = [courseLine]
    mocks.taxPlan = { grossMinor: 180000, coursePartMinor: 180000, applies: true, blocker: 'pan_missing', section: '194J', rateBasisPoints: 1000, thresholdMinor: null, financialYear: '2026-27', pan: null, tds: null, tdsMinor: 0, netMinor: 180000 }
    render(await ReviewPayoutPage({ searchParams: Promise.resolve({ seller: `profile:${USER}` }) }))
    expect(screen.getByText(/hasn't added their PAN yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /via Cashfree/ })).not.toBeInTheDocument()
    cleanup()

    mocks.taxPlan = { ...(mocks.taxPlan as object), blocker: 'tds_rate_unset' }
    render(await ReviewPayoutPage({ searchParams: Promise.resolve({ seller: `profile:${USER}` }) }))
    expect(screen.getByText(/TDS rate for course payouts is not set yet/)).toBeInTheDocument()
    cleanup()

    mocks.taxPlan = null
    mocks.lines = []
    mocks.awaiting = [courseLine]
    render(await ReviewPayoutPage({ searchParams: Promise.resolve({ seller: `profile:${USER}` }) }))
    expect(screen.getByText(/can't be paid until their invoice for August 2026 is approved/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review seller invoices' })).toHaveAttribute('href', '/admin/payments/seller-invoices')
    expect(screen.queryByRole('button', { name: /via Cashfree/ })).not.toBeInTheDocument()
  })

  it('seller invoices page lists invoices to review with amount vs expected, a private file link, and Approve / Reject', async () => {
    const invoice = {
      id: '99999999-9999-4999-8999-999999999999', seller: { profileId: USER }, period: '2026-08', kind: 'tax_invoice', documentNumber: 'INV-0042',
      amountMinor: 180000, expectedAmountMinor: 180000, storagePath: 'seller-invoices/x', fileName: 'invoice-aug.pdf', contentType: 'application/pdf', sizeBytes: 20480,
      status: 'submitted', reviewNote: null, reviewedAt: null, createdAt: '2026-09-02T10:00:00.000Z',
      sellerName: 'Arjun Rao', sellerKind: 'profile', sellerSlug: 'arjun', currentExpectedMinor: 180000, gstRegistered: true,
    }
    mocks.invoices = {
      submitted: [invoice, { ...invoice, id: '88888888-8888-4888-8888-888888888888', period: '2026-07', currentExpectedMinor: 150000 }],
      reviewed: [{ ...invoice, id: '77777777-7777-4777-8777-777777777777', period: '2026-06', status: 'rejected', reviewNote: 'Total must be ₹1,800.00', reviewedAt: '2026-07-03T10:00:00.000Z' }],
    }
    render(await AdminSellerInvoicesPage())
    expect(screen.getByRole('link', { name: 'Seller invoices' })).toHaveAttribute('href', '/admin/payments/seller-invoices')
    const links = screen.getAllByRole('link', { name: 'Open invoice-aug.pdf' })
    expect(links[0]).toHaveAttribute('href', `/api/payouts/seller-invoices/${invoice.id}`)
    expect(screen.getByRole('button', { name: 'Approve invoice for Arjun Rao, August 2026' })).toBeInTheDocument()
    // July changed after it was sent: only rejecting is offered.
    expect(screen.queryByRole('button', { name: 'Approve invoice for Arjun Rao, July 2026' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject invoice for Arjun Rao, July 2026' })).toBeInTheDocument()
    expect(screen.getByText(/Changed since it was sent/)).toBeInTheDocument()
    expect(screen.getByText('Total must be ₹1,800.00')).toBeInTheDocument()

    mocks.admin = false
    await expect(AdminSellerInvoicesPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
