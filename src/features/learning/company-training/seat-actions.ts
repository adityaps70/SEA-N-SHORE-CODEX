'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { userCan } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import type { ConfirmCheckoutResult, StartCheckoutResult } from '@/features/payments/checkout-types'
import { formatMoney } from '@/features/payments/currency'
import { loadCheckoutCustomer, PHONE_INVALID_MESSAGE, PHONE_REJECTED_MESSAGE, PHONE_REQUIRED_MESSAGE } from '@/features/payments/customer-contact'
import {
  CustomerPhoneRejectedError,
  CustomerPhoneRequiredError,
  PaymentGatewayUnavailableError,
  PaymentsNotConfiguredError,
  RefundFailedError,
} from '@/features/payments/event-payment-service'
import { PaymentVerificationError } from '@/features/payments/types'
import { billingInputSchema, billingRefusalMessage, type BillingInput, type BillingRefusal } from '@/features/tax/billing'
import { coursePaymentRepository, CoursePurchaseError } from '../course-payment-repository'
import { seatConfirmResult } from '../course-payment-messages'
import { COURSE_PAYMENTS_NOT_CONFIGURED_HELP, coursePurchaseBlockerMessage } from '../course-payment-rules'
import { coursePaymentService } from '../course-payment-runtime'
import { accessPeriodLabel } from '../course-plans'
import { SeatError, seatRefusalMessage, volumeDiscountLabel } from './seat-rules'
import { trainingRepository } from './training-repository'

/**
 * D3: a company buys, checks and refunds seat packs. Only the owner, administrators and learning managers of a
 * verified organization may (checked again inside every write). Prices are always worked out on the server.
 */

const uuid = z.string().uuid()
const quantitySchema = z.coerce.number().int()
const packSchema = z.object({
  courseId: z.string().uuid(),
  planId: z.string().uuid().nullable().optional(),
  quantity: quantitySchema,
})

async function refresh(companyId: string) {
  const slug = await trainingRepository.companySlug(companyId).catch(() => null)
  for (const path of [slug ? `/organizations/${slug}/training` : null, '/learn/studio/sales'].filter(Boolean) as string[]) {
    try {
      revalidatePath(path)
    } catch {
      // Best effort: the purchase or refund is already recorded.
    }
  }
}

function seatCheckoutError(error: unknown) {
  if (error instanceof SeatError) return seatRefusalMessage(error.code)
  if (error instanceof PaymentsNotConfiguredError) return COURSE_PAYMENTS_NOT_CONFIGURED_HELP
  if (error instanceof PaymentGatewayUnavailableError) return 'We could not reach the payment service. No money was taken. Please try again in a few minutes.'
  if (error instanceof CoursePurchaseError) {
    if (error.code === 'checkout_in_progress') return 'Your checkout is already being prepared. Wait a moment and try again.'
    if (error.code === 'plan_not_found') return 'This plan is no longer on sale. Refresh the page and choose a plan.'
    if (error.code === 'course_team_has_access') return 'This is one of your organization’s own courses, so your crew can be added to it from Studio without buying seats.'
    if (error.code.startsWith('billing_')) return billingRefusalMessage(error.code as BillingRefusal)
    return coursePurchaseBlockerMessage(error.code)
  }
  return 'We could not start the payment. No money was taken. Please try again.'
}

export type SeatPackPreviewResult =
  | { ok: true; planName: string; accessLabel: string; quantity: number; unitLabel: string; baseUnitLabel: string; discountLabel: string | null; totalLabel: string }
  | { ok: false; error: string }

/** The price of a pack, worked out exactly as checkout does (for the live total on the Buy seats form). */
export async function previewSeatPackAction(companyId: string, input: { courseId: string; planId?: string | null; quantity: number }): Promise<SeatPackPreviewResult> {
  const company = uuid.safeParse(companyId)
  const parsed = packSchema.safeParse(input)
  if (!company.success || !parsed.success) return { ok: false, error: seatRefusalMessage('seat_quantity_invalid') }
  try {
    const user = await requireAwsUser()
    const { quote, plan } = await coursePaymentRepository.previewSeatPack({ profileId: user.id, companyId: company.data, ...parsed.data })
    return {
      ok: true,
      planName: plan.name,
      accessLabel: accessPeriodLabel(plan.accessMonths),
      quantity: quote.quantity,
      unitLabel: formatMoney(quote.unitMinor, quote.currency),
      baseUnitLabel: formatMoney(quote.baseUnitMinor, quote.currency),
      discountLabel: volumeDiscountLabel(quote.volumeDiscountBasisPoints),
      totalLabel: formatMoney(quote.totalMinor, quote.currency),
    }
  } catch (error) {
    if (!(error instanceof SeatError) && !(error instanceof CoursePurchaseError)) console.error('company_seat_preview_failed', { message: error instanceof Error ? error.message : null })
    return { ok: false, error: seatCheckoutError(error) }
  }
}

/** Starts (or reuses) the company's checkout for a seat pack and opens the gateway. */
export async function startSeatCheckoutAction(
  companyId: string,
  input: { courseId: string; planId?: string | null; quantity: number; billing?: BillingInput | null; phone?: string },
): Promise<StartCheckoutResult> {
  const company = uuid.safeParse(companyId)
  const parsed = packSchema.safeParse(input)
  const billing = billingInputSchema.safeParse(input.billing)
  const phone = z.string().trim().max(30).optional().safeParse(input.phone)
  if (!company.success || !parsed.success) return { ok: false, error: seatRefusalMessage('seat_quantity_invalid') }
  if (!billing.success) return { ok: false, error: seatRefusalMessage('seat_pack_gstin_required') }
  if (!phone.success) return { ok: false, error: PHONE_INVALID_MESSAGE, needsPhone: true }
  try {
    const user = await requireAwsUser()
    if (!await userCan(user.id, 'course.enroll')) return { ok: false, error: 'Your account cannot buy courses right now.' }
    const { customer, invalidPhone } = await loadCheckoutCustomer(user, phone.data)
    if (invalidPhone) return { ok: false, error: PHONE_INVALID_MESSAGE, needsPhone: true }
    const checkout = await coursePaymentService.startSeatCheckout({
      profileId: user.id,
      companyId: company.data,
      courseId: parsed.data.courseId,
      planId: parsed.data.planId ?? null,
      quantity: parsed.data.quantity,
      billing: billing.data ?? null,
      customer,
    })
    return { ok: true, checkout: { orderId: checkout.orderId, client: checkout.client, prefill: { email: customer.email, phone: customer.phone, name: customer.name } } }
  } catch (error) {
    if (error instanceof CustomerPhoneRequiredError) return { ok: false, error: PHONE_REQUIRED_MESSAGE, needsPhone: true }
    if (error instanceof CustomerPhoneRejectedError) return { ok: false, error: PHONE_REJECTED_MESSAGE, needsPhone: true }
    if (!(error instanceof SeatError) && !(error instanceof CoursePurchaseError) && !(error instanceof PaymentsNotConfiguredError)) {
      console.error('company_seat_checkout_failed', { message: error instanceof Error ? error.message : null })
    }
    return { ok: false, error: seatCheckoutError(error) }
  }
}

/** The browser says the seat checkout finished; only the gateway's answer adds seats. */
export async function confirmSeatPaymentAction(input: { companyId: string; orderId: string; proof?: { providerPaymentId?: string; signature?: string } | null }): Promise<ConfirmCheckoutResult> {
  const parsed = z.object({
    companyId: z.string().uuid(),
    orderId: z.string().uuid(),
    proof: z.object({ providerPaymentId: z.string().trim().min(1).max(100).optional(), signature: z.string().trim().min(1).max(200).optional() }).nullable().optional(),
  }).safeParse(input)
  const unclear = 'We could not check this payment just now. If money was taken, the seats are added automatically within a few minutes. Refresh this page to check.'
  if (!parsed.success) return { ok: false, state: 'error', error: unclear }
  try {
    const user = await requireAwsUser()
    const outcome = await coursePaymentService.confirmCheckout({ profileId: user.id, orderId: parsed.data.orderId, proof: parsed.data.proof ?? undefined })
    await refresh(parsed.data.companyId)
    return seatConfirmResult(outcome)
  } catch (error) {
    if (error instanceof PaymentVerificationError) return { ok: false, state: 'error', error: 'We could not verify this payment with the payment provider. If money was taken, the seats are added automatically within a few minutes, or the amount is refunded.' }
    if (error instanceof PaymentsNotConfiguredError) return { ok: false, state: 'error', error: COURSE_PAYMENTS_NOT_CONFIGURED_HELP }
    console.error('company_seat_confirm_failed', { message: error instanceof Error ? error.message : null })
    return { ok: false, state: 'error', error: unclear }
  }
}

export type SeatRefundActionResult = { ok: true; message: string } | { ok: false; error: string }

/** Refunds unassigned seats of a pack (within 30 days of the purchase, once per pack). */
export async function refundSeatsAction(companyId: string, orderId: string, seats: number): Promise<SeatRefundActionResult> {
  const company = uuid.safeParse(companyId)
  const order = uuid.safeParse(orderId)
  const count = quantitySchema.safeParse(seats)
  if (!company.success || !order.success) return { ok: false, error: seatRefusalMessage('seat_pack_not_found') }
  if (!count.success || count.data < 1) return { ok: false, error: seatRefusalMessage('seat_refund_none_available') }
  try {
    const user = await requireAwsUser()
    const result = await coursePaymentService.refundSeats({ orderId: order.data, companyId: company.data, seats: count.data, actorProfileId: user.id })
    await refresh(company.data)
    if (result.state === 'refunded' || result.state === 'refund_pending') {
      const amount = formatMoney(result.order.amountMinor, result.order.currency)
      return { ok: true, message: result.state === 'refunded' ? `Refunded ${amount} for the whole pack. It is on its way back to the original payment method, with a credit note.` : `Refund of ${amount} for the whole pack started. The payment provider is processing it.` }
    }
    const amount = formatMoney(result.amountMinor, result.order.currency)
    const what = `${result.seats} ${result.seats === 1 ? 'seat' : 'seats'}`
    return { ok: true, message: result.state === 'seats_refunded' ? `Refunded ${amount} for ${what}, with a credit note. The money is on its way back to the original payment method.` : `Refund of ${amount} for ${what} started. The payment provider is processing it.` }
  } catch (error) {
    if (error instanceof SeatError) return { ok: false, error: seatRefusalMessage(error.code) }
    if (error instanceof CoursePurchaseError) {
      if (error.code === 'refund_in_progress') return { ok: false, error: seatRefusalMessage('seat_refund_in_progress') }
      return { ok: false, error: seatRefusalMessage('seat_pack_not_found') }
    }
    if (error instanceof PaymentsNotConfiguredError) return { ok: false, error: 'The payment provider that took this payment is not connected right now, so it cannot be refunded here. Contact the Sea N Shore team.' }
    if (error instanceof RefundFailedError) return { ok: false, error: `The payment provider did not accept the refund${error.providerMessage ? `: ${error.providerMessage.replace(/\.$/, '')}` : ''}. Nothing was refunded and the seats are still yours. Try again later.` }
    console.error('company_seat_refund_failed', { message: error instanceof Error ? error.message : null })
    return { ok: false, error: 'We could not refund these seats just now. Nothing was refunded. Please try again in a few minutes.' }
  }
}
