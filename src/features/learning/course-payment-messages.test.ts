import { describe, expect, it } from 'vitest'
import { courseConfirmResult, courseViewerResult } from './course-payment-messages'
import type { CoursePaymentOrder } from './course-payment-repository'
import { coursePurchaseStatusLabel } from './course-payment-rules'

const order = {
  id: '33333333-3333-4333-8333-333333333333',
  courseId: '22222222-2222-4222-8222-222222222222',
  courseTitle: 'SIRE 2.0 Masterclass',
  amountMinor: 49950,
  currency: 'INR',
  refundDueReason: 'already_enrolled',
} as unknown as CoursePaymentOrder

describe('course payment messages', () => {
  it('tells the returning learner exactly what was paid and opens the course', () => {
    expect(courseViewerResult({ state: 'enrolled', order }, 'sire-2')).toEqual({
      state: 'paid',
      title: "Payment received — you're enrolled",
      message: 'We received ₹499.50 for SIRE 2.0 Masterclass. The course is now in My Learning.',
      returnHref: '/learn/courses/sire-2/learn',
      returnLabel: 'Start learning',
    })
  })

  it('explains every unhappy outcome and always says whether money was taken', () => {
    expect(courseViewerResult({ state: 'processing', order }, 'sire-2')).toMatchObject({ returnHref: '/learn/courses/sire-2', message: expect.stringMatching(/has not confirmed the payment of ₹499.50 yet/) })
    expect(courseViewerResult({ state: 'failed', order, message: 'Card declined.' }, 'sire-2').message).toBe('Card declined. No money was taken. Go back to the course to try again or use a different payment method.')
    expect(courseViewerResult({ state: 'not_paid', order }, 'sire-2').message).toMatch(/no money was taken/)
    expect(courseViewerResult({ state: 'expired', order }, 'sire-2').title).toBe('This checkout has expired')
    expect(courseViewerResult({ state: 'refunded', order }, 'sire-2').message).toMatch(/You already had this course, so this was a duplicate payment/)
    expect(courseViewerResult({ state: 'refund_due', order, reason: 'course_not_found' }, null)).toMatchObject({ returnHref: '/learn/my-learning', message: expect.stringMatching(/will refund the full amount/) })
    expect(courseViewerResult(null, null)).toMatchObject({ state: 'not_found', returnHref: '/learn/my-learning' })
  })

  it('gives the checkout button plain results', () => {
    expect(courseConfirmResult({ state: 'enrolled', order })).toEqual({ ok: true, state: 'paid', message: "Payment of ₹499.50 received. You're enrolled — opening the course…" })
    expect(courseConfirmResult({ state: 'not_paid', order })).toMatchObject({ ok: false, state: 'not_paid', error: expect.stringMatching(/No money was taken/) })
    expect(courseConfirmResult({ state: 'refund_due', order, reason: 'amount_mismatch' })).toMatchObject({ ok: false, error: expect.stringMatching(/did not match the course price.*refund the full ₹499.50/) })
  })

  it('labels purchase statuses for receipts and the sales list', () => {
    expect(coursePurchaseStatusLabel({ status: 'paid', enrollmentConfirmedAt: 'x' }).label).toBe('Paid')
    expect(coursePurchaseStatusLabel({ status: 'paid', enrollmentConfirmedAt: null }).label).toBe('Refund due')
    expect(coursePurchaseStatusLabel({ status: 'paid', enrollmentConfirmedAt: 'x', refundStatus: 'requested' }).label).toBe('Refund in progress')
    expect(coursePurchaseStatusLabel({ status: 'refunded', enrollmentConfirmedAt: 'x', refundStatus: 'pending' }).label).toBe('Refund on its way')
    expect(coursePurchaseStatusLabel({ status: 'refunded', enrollmentConfirmedAt: 'x', refundStatus: 'processed' }).label).toBe('Refunded')
  })
})
