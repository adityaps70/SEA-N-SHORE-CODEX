'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { userCan } from '@/features/access/server'
import { canAccessPlatformAdmin } from '@/features/admin/access'
import { requireAwsUser } from '@/features/auth/aws-queries'
import type { ConfirmCheckoutResult, StartCheckoutResult } from '@/features/payments/checkout-types'
import { loadCheckoutCustomer, PHONE_INVALID_MESSAGE, PHONE_REJECTED_MESSAGE, PHONE_REQUIRED_MESSAGE } from '@/features/payments/customer-contact'
import { formatMoney } from '@/features/payments/currency'
import {
  CustomerPhoneRejectedError,
  CustomerPhoneRequiredError,
  PaymentGatewayUnavailableError,
  PaymentsNotConfiguredError,
  RefundFailedError,
} from '@/features/payments/event-payment-service'
import { PaymentVerificationError } from '@/features/payments/types'
import { courseConfirmResult } from './course-payment-messages'
import { coursePaymentRepository, CoursePurchaseError } from './course-payment-repository'
import { COURSE_PAYMENTS_NOT_CONFIGURED_HELP, coursePurchaseBlockerMessage } from './course-payment-rules'
import { coursePaymentService } from './course-payment-runtime'
import { coursePurchasePaths } from './course-payment-service'

export type RefundCoursePaymentResult = { ok: true; message: string } | { ok: false; error: string }

const uuidSchema = z.string().uuid()
const phoneSchema = z.string().trim().max(30).optional()
const confirmSchema = z.object({
  courseId: z.string().uuid(),
  orderId: z.string().uuid(),
  proof: z.object({
    providerPaymentId: z.string().trim().min(1).max(100).optional(),
    signature: z.string().trim().min(1).max(200).optional(),
  }).nullable().optional(),
})

function refresh(courseSlug: string | null) {
  for (const path of coursePurchasePaths(courseSlug)) {
    try {
      revalidatePath(path)
    } catch {
      // Cache refresh is best effort; the purchase itself is already recorded.
    }
  }
}

function checkoutError(error: unknown) {
  if (error instanceof PaymentsNotConfiguredError) return COURSE_PAYMENTS_NOT_CONFIGURED_HELP
  if (error instanceof PaymentGatewayUnavailableError) return 'We could not reach the payment service. No money was taken. Please try again in a few minutes.'
  if (error instanceof CoursePurchaseError) {
    if (error.code === 'checkout_in_progress') return 'Your checkout is already being prepared. Wait a moment and try again.'
    if (error.code === 'order_not_found') return 'We could not find this checkout. Select Buy course again.'
    return coursePurchaseBlockerMessage(error.code)
  }
  return 'We could not start the payment. No money was taken. Please try again.'
}

/**
 * Creates (or reuses) the learner's order for a paid course and opens the gateway
 * checkout. The price always comes from the course row on the server.
 */
export async function startCourseCheckoutAction(courseId: string, options: { phone?: string } = {}): Promise<StartCheckoutResult> {
  const id = uuidSchema.safeParse(courseId)
  const phone = phoneSchema.safeParse(options.phone)
  if (!id.success) return { ok: false, error: coursePurchaseBlockerMessage('course_not_found') }
  if (!phone.success) return { ok: false, error: PHONE_INVALID_MESSAGE, needsPhone: true }
  try {
    const user = await requireAwsUser()
    if (!await userCan(user.id, 'course.enroll')) {
      return { ok: false, error: 'Your account cannot enroll in courses right now.' }
    }
    if (await canAccessPlatformAdmin(user.id)) {
      return { ok: false, error: 'You are on the Sea N Shore team, so you already have access to this course without buying it. Use Open course instead.' }
    }
    const { customer, invalidPhone } = await loadCheckoutCustomer(user, phone.data)
    if (invalidPhone) return { ok: false, error: PHONE_INVALID_MESSAGE, needsPhone: true }
    const checkout = await coursePaymentService.startCheckout({ profileId: user.id, courseId: id.data, customer })
    return {
      ok: true,
      checkout: {
        orderId: checkout.orderId,
        client: checkout.client,
        prefill: { email: customer.email, phone: customer.phone, name: customer.name },
      },
    }
  } catch (error) {
    if (error instanceof CustomerPhoneRequiredError) return { ok: false, error: PHONE_REQUIRED_MESSAGE, needsPhone: true }
    if (error instanceof CustomerPhoneRejectedError) return { ok: false, error: PHONE_REJECTED_MESSAGE, needsPhone: true }
    if (!(error instanceof CoursePurchaseError) && !(error instanceof PaymentsNotConfiguredError)) {
      console.error('course_checkout_start_failed', { message: error instanceof Error ? error.message : null })
    }
    return { ok: false, error: checkoutError(error) }
  }
}

/**
 * The browser says checkout finished (or the learner asked to check a payment). The
 * server asks the gateway and only a paid answer enrolls the learner.
 */
export async function confirmCoursePaymentAction(input: {
  courseId: string
  orderId: string
  proof?: { providerPaymentId?: string; signature?: string } | null
}): Promise<ConfirmCheckoutResult> {
  const parsed = confirmSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, state: 'error', error: 'We could not check this payment. If money was taken, the course unlocks automatically within a few minutes.' }
  }
  try {
    const user = await requireAwsUser()
    const outcome = await coursePaymentService.confirmCheckout({
      profileId: user.id,
      orderId: parsed.data.orderId,
      proof: parsed.data.proof ?? undefined,
    })
    refresh(await coursePaymentRepository.getCourseSlug(outcome.order.courseId ?? parsed.data.courseId))
    return courseConfirmResult(outcome)
  } catch (error) {
    if (error instanceof PaymentVerificationError) {
      return { ok: false, state: 'error', error: 'We could not verify this payment with the payment provider. If money was taken, the course unlocks automatically within a few minutes, or the amount is refunded.' }
    }
    if (error instanceof PaymentsNotConfiguredError) return { ok: false, state: 'error', error: COURSE_PAYMENTS_NOT_CONFIGURED_HELP }
    if (error instanceof CoursePurchaseError && error.code === 'order_not_found') {
      return { ok: false, state: 'error', error: 'We could not find this checkout. Refresh the page — if money was taken, the course unlocks automatically within a few minutes.' }
    }
    console.error('course_checkout_confirm_failed', { message: error instanceof Error ? error.message : null })
    return { ok: false, state: 'error', error: 'We could not check your payment just now. If money was taken, the course unlocks automatically within a few minutes. Refresh this page to check.' }
  }
}

/**
 * Refunds one course purchase in full through the gateway that took it. Allowed for
 * the course owner, its organization's owners / administrators / LMS managers, and
 * platform admins. The learner's access ends and the seller's earning is reversed.
 */
export async function refundCoursePaymentAction(orderId: string): Promise<RefundCoursePaymentResult> {
  const id = uuidSchema.safeParse(orderId)
  if (!id.success) return { ok: false, error: 'We could not find this purchase. Refresh the page and try again.' }
  try {
    const user = await requireAwsUser()
    const managed = await coursePaymentRepository.getOrderForManager(id.data, user.id)
    const isAdmin = managed ? false : await canAccessPlatformAdmin(user.id)
    const order = managed ?? (isAdmin ? await coursePaymentRepository.getOrderById(id.data) : null)
    if (!order) return { ok: false, error: 'Only the course owner, its organization’s learning managers or the Sea N Shore team can refund this purchase.' }

    const result = await coursePaymentService.refundOrder({
      orderId: order.id,
      actor: { type: isAdmin ? 'admin' : 'organizer', profileId: user.id },
      reason: isAdmin ? 'admin_refund' : 'course_team_refund',
    })
    refresh(await coursePaymentRepository.getCourseSlug(order.courseId))
    const amount = formatMoney(order.amountMinor, order.currency)
    return {
      ok: true,
      message: result.state === 'refunded'
        ? `Refunded ${amount}. The learner's access has ended and the money is on its way back to their original payment method.`
        : `Refund of ${amount} started. The payment provider is processing it; the learner's access has ended.`,
    }
  } catch (error) {
    if (error instanceof CoursePurchaseError) {
      if (error.code === 'refund_in_progress') return { ok: false, error: 'A refund for this purchase is already being processed. Refresh the page in a minute to see the result.' }
      if (error.code === 'refund_not_allowed') return { ok: false, error: 'This purchase cannot be refunded here — it is not a completed payment, or it was already refunded.' }
      return { ok: false, error: 'We could not find this purchase. Refresh the page and try again.' }
    }
    if (error instanceof PaymentsNotConfiguredError) {
      return { ok: false, error: 'The payment provider that took this payment is not connected right now, so it cannot be refunded here. Contact the Sea N Shore team.' }
    }
    if (error instanceof RefundFailedError) {
      return { ok: false, error: `The payment provider did not accept the refund${error.providerMessage ? `: ${error.providerMessage.replace(/\.$/, '')}` : ''}. Nothing was refunded. Try again later or contact the Sea N Shore team.` }
    }
    console.error('course_payment_refund_action_failed', { message: error instanceof Error ? error.message : null })
    return { ok: false, error: 'We could not refund this purchase just now. Nothing was refunded. Please try again in a few minutes.' }
  }
}
