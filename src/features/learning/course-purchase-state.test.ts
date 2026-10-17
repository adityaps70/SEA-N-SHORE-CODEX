import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessPlatformAdmin: vi.fn(),
  getPaymentCapabilities: vi.fn(),
  isCourseManager: vi.fn(),
  getRefundDueOrder: vi.fn(),
  getRecentOpenOrder: vi.fn(),
  listPlans: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/features/admin/access', () => ({ canAccessPlatformAdmin: mocks.canAccessPlatformAdmin }))
vi.mock('@/features/payments/provider', () => ({ getPaymentCapabilities: mocks.getPaymentCapabilities }))
vi.mock('./course-payment-repository', () => ({
  coursePaymentRepository: {
    isCourseManager: mocks.isCourseManager,
    getRefundDueOrder: mocks.getRefundDueOrder,
    getRecentOpenOrder: mocks.getRecentOpenOrder,
  },
}))

vi.mock('./course-plan-repository', () => ({ coursePlanRepository: { list: mocks.listPlans } }))

import { loadCoursePurchaseState } from './course-purchase-state'
import { coursePrice, courseSellerNet, discountPercent, formatFeePercent } from './course-pricing'
import { computePlatformFee } from '@/features/payments/earnings'

const userId = '11111111-1111-4111-8111-111111111111'
const course = { id: '22222222-2222-4222-8222-222222222222', accessType: 'paid' as const, priceMinor: 500000, discountPriceMinor: 400000, currency: 'INR' }
const enrollment = (overrides: Record<string, unknown> = {}) => ({
  enrollmentId: 'e1', status: 'active', enrollmentSource: 'purchase', enrolledAt: '2030-01-01T10:00:00.000Z', completedAt: null, revokedAt: null, ...overrides,
}) as never

beforeEach(() => {
  vi.clearAllMocks()
  mocks.canAccessPlatformAdmin.mockResolvedValue(false)
  mocks.isCourseManager.mockResolvedValue(false)
  mocks.getPaymentCapabilities.mockResolvedValue({ configured: true, provider: 'cashfree', currencies: ['INR'] })
  mocks.getRefundDueOrder.mockResolvedValue(null)
  mocks.getRecentOpenOrder.mockResolvedValue(null)
  mocks.listPlans.mockResolvedValue([standardPlan])
})

const standardPlan = { id: 'plan-standard', name: 'Standard', priceMinor: 500000, discountPriceMinor: 400000, currency: 'INR', accessMonths: null, position: 0 }
// Round H (H7): without a recent sale at the list price, the list price is not struck through.
const standardOffer = { id: 'plan-standard', name: 'Standard', priceLabel: '₹4,000', listLabel: null, accessLabel: 'Lifetime access', currency: 'INR', amountMinor: 400_000, unavailableMessage: null }

describe('course purchase state', () => {
  it('offers Buy course at the discounted price when payments are on', async () => {
    await expect(loadCoursePurchaseState({ userId, course, enrollment: null })).resolves.toEqual({
      kind: 'buy', priceLabel: '₹4,000', plans: [standardOffer], renewal: null, configured: true, blockedMessage: undefined, pending: null,
    })
  })

  it('strikes through a plan\'s list price only after a sale at that price on that plan (Round H, H7)', async () => {
    const sale = { courseId: course.id, planId: 'plan-standard', listPriceMinor: 500000, currency: 'INR' }
    await expect(loadCoursePurchaseState({ userId, course, enrollment: null, listPriceSales: [sale] })).resolves.toMatchObject({
      plans: [{ ...standardOffer, listLabel: '₹5,000' }],
    })
    // A sale on another plan, at another price or for another course is not evidence.
    for (const other of [{ ...sale, planId: 'plan-six' }, { ...sale, listPriceMinor: 450000 }, { ...sale, courseId: userId }]) {
      await expect(loadCoursePurchaseState({ userId, course, enrollment: null, listPriceSales: [other] })).resolves.toMatchObject({
        plans: [standardOffer],
      })
    }
  })

  it('shows "Purchases open soon" (not a broken button) when payments are not set up or cannot be read', async () => {
    mocks.getPaymentCapabilities.mockResolvedValueOnce({ configured: false, provider: null, currencies: [] })
    await expect(loadCoursePurchaseState({ userId, course, enrollment: null })).resolves.toMatchObject({ kind: 'buy', configured: false })
    mocks.getPaymentCapabilities.mockRejectedValueOnce(new Error('secrets unavailable'))
    await expect(loadCoursePurchaseState({ userId, course, enrollment: null })).resolves.toMatchObject({ kind: 'buy', configured: false })
    expect(mocks.getRecentOpenOrder).not.toHaveBeenCalled()
  })

  it('keeps USD plans closed until an LUT is saved for the financial year (C4)', async () => {
    mocks.getPaymentCapabilities.mockResolvedValueOnce({ configured: true, provider: 'cashfree', currencies: ['INR', 'USD'] })
    mocks.listPlans.mockResolvedValueOnce([{ ...standardPlan, currency: 'USD', priceMinor: 9_900, discountPriceMinor: null }])
    const state = await loadCoursePurchaseState({ userId, course: { ...course, currency: 'USD', priceMinor: 9_900, discountPriceMinor: null }, enrollment: null })
    expect(state).toMatchObject({ kind: 'buy', blockedMessage: expect.stringMatching(/US dollars open soon/) })
    expect(state).toMatchObject({ plans: [{ unavailableMessage: expect.stringMatching(/US dollars open soon/) }] })
  })

  it('explains a currency the gateway cannot take', async () => {
    mocks.getPaymentCapabilities.mockResolvedValueOnce({ configured: true, provider: 'cashfree', currencies: ['INR'] })
    await expect(loadCoursePurchaseState({ userId, course: { ...course, currency: 'USD' }, enrollment: null }))
      .resolves.toMatchObject({ kind: 'buy', blockedMessage: expect.stringMatching(/currency Sea N Shore can't accept yet/) })
  })

  it('shows the pending checkout so the learner can check its status', async () => {
    mocks.getRecentOpenOrder.mockResolvedValueOnce({ id: 'o1', amountMinor: 400000, currency: 'INR', createdAt: '2030-01-01T04:35:00.000Z' })
    await expect(loadCoursePurchaseState({ userId, course, enrollment: null })).resolves.toMatchObject({
      kind: 'buy', pending: { orderId: 'o1', amountLabel: '₹4,000', startedLabel: expect.stringContaining('2030') },
    })
  })

  it('sends enrolled learners to the course, and gives the course team access without buying', async () => {
    await expect(loadCoursePurchaseState({ userId, course, enrollment: enrollment() })).resolves.toEqual({ kind: 'enrolled', viaTeam: false, completed: false, accessUntilLabel: null })
    mocks.isCourseManager.mockResolvedValueOnce(true)
    await expect(loadCoursePurchaseState({ userId, course, enrollment: null })).resolves.toEqual({ kind: 'team', reason: 'You manage this course' })
    mocks.canAccessPlatformAdmin.mockResolvedValueOnce(true)
    await expect(loadCoursePurchaseState({ userId, course, enrollment: null })).resolves.toEqual({ kind: 'team', reason: 'Sea N Shore team access' })
  })

  it('ends team access for someone who left the team: they see Buy course again', async () => {
    await expect(loadCoursePurchaseState({ userId, course, enrollment: enrollment({ enrollmentSource: 'admin' }) })).resolves.toMatchObject({ kind: 'buy' })
  })

  it('offers buying again after a refund, but not after access was removed for another reason', async () => {
    await expect(loadCoursePurchaseState({ userId, course, enrollment: enrollment({ status: 'revoked' }) })).resolves.toMatchObject({ kind: 'buy' })
    await expect(loadCoursePurchaseState({ userId, course, enrollment: enrollment({ status: 'revoked', enrollmentSource: 'free' }) })).resolves.toMatchObject({ kind: 'revoked' })
  })

  it('offers every plan, shows when time-limited access ends, and offers renewal once it has ended (round C)', async () => {
    mocks.listPlans.mockResolvedValue([
      standardPlan,
      { id: 'plan-six', name: 'Self-paced', priceMinor: 150000, discountPriceMinor: null, currency: 'INR', accessMonths: 6, position: 1 },
    ])
    await expect(loadCoursePurchaseState({ userId, course, enrollment: null })).resolves.toMatchObject({
      kind: 'buy',
      plans: [standardOffer, { id: 'plan-six', name: 'Self-paced', priceLabel: '₹1,500', listLabel: null, accessLabel: '6 months of access' }],
      renewal: null,
    })
    await expect(loadCoursePurchaseState({ userId, course, enrollment: enrollment({ accessExpiresAt: '2099-03-01T00:00:00.000Z' }) }))
      .resolves.toEqual({ kind: 'enrolled', viaTeam: false, completed: false, accessUntilLabel: '1 March 2099' })
    await expect(loadCoursePurchaseState({ userId, course, enrollment: enrollment({ accessExpiresAt: '2020-03-01T00:00:00.000Z' }) }))
      .resolves.toMatchObject({ kind: 'buy', renewal: { endedLabel: '1 March 2020' } })
    // A plan that cannot be charged (no valid price) is not offered.
    mocks.listPlans.mockResolvedValue([{ ...standardPlan, priceMinor: 50, discountPriceMinor: null }])
    await expect(loadCoursePurchaseState({ userId, course, enrollment: null })).resolves.toMatchObject({ plans: [] })
  })

  it('tells the learner when a payment arrived but a refund is due', async () => {
    mocks.getRefundDueOrder.mockResolvedValueOnce({ amountMinor: 400000, currency: 'INR', paidAt: '2030-01-01T04:35:00.000Z', createdAt: '2030-01-01T04:30:00.000Z', refundDueReason: 'already_enrolled', refundStatus: null })
    await expect(loadCoursePurchaseState({ userId, course, enrollment: null })).resolves.toMatchObject({
      kind: 'refund_due', amountLabel: '₹4,000', reason: 'You already had this course, so this was a duplicate payment.', refundInProgress: false,
    })
  })
})

describe('course pricing', () => {
  it('applies a discount only when it is at least ₹1 and below the list price', () => {
    expect(coursePrice(course)).toEqual({ amountMinor: 400000, listPriceMinor: 500000, discountPriceMinor: 400000, currency: 'INR' })
    expect(coursePrice({ ...course, discountPriceMinor: 500000 })).toMatchObject({ amountMinor: 500000, discountPriceMinor: null })
    expect(coursePrice({ ...course, discountPriceMinor: 0 })).toMatchObject({ amountMinor: 500000, discountPriceMinor: null })
    expect(coursePrice({ ...course, accessType: 'free', priceMinor: 0 })).toBeNull()
    expect(coursePrice({ ...course, currency: 'EUR' })).toBeNull()
    expect(coursePrice({ ...course, priceMinor: 50, discountPriceMinor: null })).toBeNull()
    expect(discountPercent(coursePrice(course)!)).toBe(20)
  })

  it('works out the seller share exactly like the earnings ledger', () => {
    for (const [gross, percent] of [[400000, '10.00'], [49950, '12.50'], [5, '10'], [99999, '0'], [123457, '33.33']] as const) {
      const ledger = computePlatformFee(gross, percent)
      expect(courseSellerNet(gross, percent)).toEqual({ feeMinor: ledger.feeMinor, netMinor: ledger.netMinor })
    }
    expect(courseSellerNet(0, '10')).toBeNull()
    expect(formatFeePercent('10.00')).toBe('10')
    expect(formatFeePercent('12.50')).toBe('12.5')
  })
})
