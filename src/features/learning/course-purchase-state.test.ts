import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessPlatformAdmin: vi.fn(),
  getPaymentCapabilities: vi.fn(),
  isCourseManager: vi.fn(),
  getRefundDueOrder: vi.fn(),
  getRecentOpenOrder: vi.fn(),
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
})

describe('course purchase state', () => {
  it('offers Buy course at the discounted price when payments are on', async () => {
    await expect(loadCoursePurchaseState({ userId, course, enrollment: null })).resolves.toEqual({
      kind: 'buy', priceLabel: '₹4,000', configured: true, blockedMessage: undefined, pending: null,
    })
  })

  it('shows "Purchases open soon" (not a broken button) when payments are not set up or cannot be read', async () => {
    mocks.getPaymentCapabilities.mockResolvedValueOnce({ configured: false, provider: null, currencies: [] })
    await expect(loadCoursePurchaseState({ userId, course, enrollment: null })).resolves.toMatchObject({ kind: 'buy', configured: false })
    mocks.getPaymentCapabilities.mockRejectedValueOnce(new Error('secrets unavailable'))
    await expect(loadCoursePurchaseState({ userId, course, enrollment: null })).resolves.toMatchObject({ kind: 'buy', configured: false })
    expect(mocks.getRecentOpenOrder).not.toHaveBeenCalled()
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
    await expect(loadCoursePurchaseState({ userId, course, enrollment: enrollment() })).resolves.toEqual({ kind: 'enrolled', viaTeam: false, completed: false })
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
