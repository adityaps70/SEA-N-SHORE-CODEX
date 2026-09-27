import { canAccessPlatformAdmin } from '@/features/admin/access'
import { getPaymentCapabilities, type PaymentCapabilities } from '@/features/payments/provider'
import type { CoursePurchaseState } from './components/course-purchase-panel'
import { coursePaymentRepository } from './course-payment-repository'
import { coursePurchaseBlockerMessage, courseRefundReasonLabel } from './course-payment-rules'
import { coursePrice, formatCourseAmount, type CoursePriceSource } from './course-pricing'
import type { LearnerEnrollment } from './enrollment-repository'

const OFF: PaymentCapabilities = { configured: false, provider: null, currencies: [] }

export function formatPurchaseTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(date)
}

async function capabilities(log: (message: string) => void) {
  try {
    return await getPaymentCapabilities()
  } catch (error) {
    // Missing or unreadable payment settings keep purchases safely switched off.
    log(error instanceof Error ? error.message : 'payment_capabilities_failed')
    return OFF
  }
}

/**
 * Everything the course page needs to show the right purchase state for a paid
 * course. Server only. Any lookup that fails leaves the page usable: payments show
 * as "Purchases open soon" rather than a broken button.
 */
export async function loadCoursePurchaseState(input: {
  userId: string
  course: CoursePriceSource & { id: string }
  enrollment: LearnerEnrollment | null
}): Promise<CoursePurchaseState> {
  const { userId, course, enrollment } = input
  const log = (message: string) => console.error('course_purchase_state_failed', { courseId: course.id, message })
  const [isManager, isAdmin] = await Promise.all([
    coursePaymentRepository.isCourseManager(userId, course.id).catch(() => false),
    canAccessPlatformAdmin(userId),
  ])
  const onTeam = isManager || isAdmin
  const hasEnrollment = enrollment?.status === 'active' || enrollment?.status === 'completed'
  const teamEnrollment = enrollment?.enrollmentSource === 'admin'

  if (hasEnrollment && (!teamEnrollment || onTeam)) {
    return { kind: 'enrolled', viaTeam: teamEnrollment, completed: enrollment?.status === 'completed' }
  }
  if (onTeam) {
    return { kind: 'team', reason: isManager ? 'You manage this course' : 'Sea N Shore team access' }
  }
  if (enrollment?.status === 'revoked' && enrollment.enrollmentSource !== 'purchase') {
    return { kind: 'revoked', message: coursePurchaseBlockerMessage('enrollment_revoked') }
  }

  const refundDue = await coursePaymentRepository.getRefundDueOrder(userId, course.id).catch(() => null)
  if (refundDue) {
    return {
      kind: 'refund_due',
      amountLabel: formatCourseAmount(refundDue.amountMinor, refundDue.currency),
      paidLabel: formatPurchaseTime(refundDue.paidAt ?? refundDue.createdAt),
      reason: courseRefundReasonLabel(refundDue.refundDueReason),
      refundInProgress: refundDue.refundStatus === 'requested' || refundDue.refundStatus === 'pending',
    }
  }

  const price = coursePrice(course)
  const payments = await capabilities(log)
  const blockedMessage = !price
    ? coursePurchaseBlockerMessage(['INR', 'USD'].includes(course.currency) ? 'course_price_missing' : 'course_currency_unsupported')
    : payments.configured && !payments.currencies.includes(price.currency)
      ? coursePurchaseBlockerMessage('course_currency_unsupported')
      : undefined
  const open = payments.configured ? await coursePaymentRepository.getRecentOpenOrder(userId, course.id).catch(() => null) : null

  return {
    kind: 'buy',
    priceLabel: formatCourseAmount(price?.amountMinor ?? course.priceMinor, price?.currency ?? course.currency),
    configured: payments.configured,
    blockedMessage,
    pending: open
      ? { orderId: open.id, amountLabel: formatCourseAmount(open.amountMinor, open.currency), startedLabel: formatPurchaseTime(open.createdAt) }
      : null,
  }
}
