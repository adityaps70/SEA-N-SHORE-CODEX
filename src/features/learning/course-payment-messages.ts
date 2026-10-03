import type { ConfirmCheckoutResult } from '@/features/payments/checkout-types'
import { formatMoney } from '@/features/payments/currency'
import type { ViewerConfirmResult } from '@/features/payments/order-handler-types'
import { courseRefundReasonLabel } from './course-payment-rules'
import type { CourseCheckoutOutcome } from './course-payment-service'

/** Plain words for every checkout outcome, for the checkout button (no page change). */
export function courseConfirmResult(outcome: CourseCheckoutOutcome): ConfirmCheckoutResult {
  const amount = formatMoney(outcome.order.amountMinor, outcome.order.currency)
  switch (outcome.state) {
    case 'enrolled':
      return { ok: true, state: 'paid', message: `Payment of ${amount} received. You're enrolled — opening the course…` }
    case 'refunded':
      return {
        ok: false,
        state: 'refunded',
        error: `We received your payment but could not unlock the course. ${courseRefundReasonLabel(outcome.order.refundDueReason)} The full ${amount} has been refunded to your original payment method (usually 5–7 working days).`,
      }
    case 'refund_due':
      return {
        ok: false,
        state: 'refund_due',
        error: `We received your payment but could not unlock the course. ${courseRefundReasonLabel(outcome.reason)} The Sea N Shore team will refund the full ${amount}.`,
      }
    case 'processing':
      return { ok: false, state: 'processing', error: `Your bank hasn't confirmed the payment of ${amount} yet. The course unlocks automatically as soon as it does — refresh this page in a minute to check.` }
    case 'failed':
      return { ok: false, state: 'failed', error: `The payment didn't go through${outcome.message ? `: ${outcome.message.replace(/\.$/, '')}` : ''}. No money was taken. You can try again or use a different payment method.` }
    case 'expired':
      return { ok: false, state: 'expired', error: 'This checkout expired before it was paid. No money was taken. Select Buy course again to start a new checkout.' }
    case 'not_paid':
    default:
      return { ok: false, state: 'not_paid', error: 'The payment window closed before the payment was made. No money was taken. You can buy the course whenever you are ready.' }
  }
}

/** What /payments/return shows for a course order, after asking the gateway. */
export function courseViewerResult(outcome: CourseCheckoutOutcome | null, courseSlug: string | null): ViewerConfirmResult {
  if (!outcome) {
    return {
      state: 'not_found',
      title: 'We could not find this payment',
      message: 'This payment link is not linked to your account. If money was taken, your course unlocks automatically within a few minutes — check My Learning.',
      returnHref: '/learn/my-learning',
      returnLabel: 'Go to My Learning',
    }
  }
  const { order } = outcome
  const amount = formatMoney(order.amountMinor, order.currency)
  const title = order.courseTitle || 'your course'
  const coursePage = courseSlug ? `/learn/courses/${courseSlug}` : '/learn/my-learning'
  const back = { returnHref: coursePage, returnLabel: courseSlug ? 'Back to the course' : 'Go to My Learning' }
  switch (outcome.state) {
    case 'enrolled':
      return {
        state: 'paid',
        title: "Payment received — you're enrolled",
        message: `We received ${amount} for ${title}. The course is now in My Learning.`,
        returnHref: courseSlug ? `/learn/courses/${courseSlug}/learn` : '/learn/my-learning',
        returnLabel: 'Start learning',
      }
    case 'refunded':
      return { ...back, state: 'refunded', title: 'Your payment was refunded', message: `We received ${amount} but could not unlock the course. ${courseRefundReasonLabel(order.refundDueReason)} The full amount is on its way back to your original payment method (usually 5–7 working days).` }
    case 'refund_due':
      return { ...back, state: 'refund_due', title: 'Payment received, course not unlocked', message: `We received ${amount} but could not unlock the course. ${courseRefundReasonLabel(outcome.reason)} The Sea N Shore team will refund the full amount.` }
    case 'processing':
      return { ...back, state: 'processing', title: 'Waiting for your bank', message: `Your bank has not confirmed the payment of ${amount} yet. This usually takes a minute. Check again shortly — if it goes through, the course unlocks automatically.` }
    case 'failed':
      return { ...back, state: 'failed', title: "The payment didn't go through", message: `${outcome.message ? `${outcome.message.replace(/\.$/, '')}. ` : ''}No money was taken. Go back to the course to try again or use a different payment method.` }
    case 'expired':
      return { ...back, state: 'expired', title: 'This checkout has expired', message: 'No money was taken. Go back to the course and start again to buy it.' }
    case 'not_paid':
    default:
      return { ...back, state: 'not_paid', title: 'No payment was made', message: 'The payment was not completed, so no money was taken. Go back to the course to try again.' }
  }
}
