'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { userCan } from '@/features/access/server'
import { canAccessPlatformAdmin } from '@/features/admin/access'
import type { ConfirmCheckoutResult, StartCheckoutResult } from './checkout-types'
import { loadCheckoutCustomer, PHONE_INVALID_MESSAGE, PHONE_REJECTED_MESSAGE, PHONE_REQUIRED_MESSAGE } from './customer-contact'
import { EventRegistrationError, eventPaymentRepository } from './event-payment-repository'
import { PAYMENTS_NOT_CONFIGURED_MESSAGE, refundReasonLabel, registrationBlockerMessage } from './event-payment-rules'
import { eventPaymentService } from './event-payment-runtime'
import {
  CustomerPhoneRejectedError,
  CustomerPhoneRequiredError,
  eventPaths,
  PaymentGatewayUnavailableError,
  PaymentsNotConfiguredError,
  PaymentVerificationError,
  RefundFailedError,
  type EventConfirmOutcome,
} from './event-payment-service'
import { formatMoney } from './currency'

export type StartEventCheckoutResult = StartCheckoutResult
export type ConfirmEventPaymentResult = ConfirmCheckoutResult
export type RefundEventPaymentResult = { ok: true; message: string } | { ok: false; error: string }

const eventIdSchema = z.string().uuid()
const phoneSchema = z.string().trim().max(30).optional()
const confirmSchema = z.object({
  eventId: z.string().uuid(),
  orderId: z.string().uuid(),
  proof: z.object({
    providerPaymentId: z.string().trim().min(1).max(100).optional(),
    signature: z.string().trim().min(1).max(200).optional(),
  }).nullable().optional(),
})

function refreshEventPaths(eventId: string) {
  for (const path of eventPaths(eventId)) revalidatePath(path)
}

function checkoutError(error: unknown) {
  if (error instanceof PaymentsNotConfiguredError) return PAYMENTS_NOT_CONFIGURED_MESSAGE
  if (error instanceof PaymentGatewayUnavailableError) return 'We could not reach the payment service. No money was taken. Please try again in a few minutes.'
  if (error instanceof EventRegistrationError) {
    if (error.code === 'checkout_in_progress') return 'Your checkout is already being prepared. Wait a moment and try again.'
    if (error.code === 'order_not_found') return 'We could not find this checkout. Start registration again.'
    return registrationBlockerMessage(error.code)
  }
  return 'We could not start the payment. No money was taken. Please try again.'
}

export async function startEventCheckoutAction(eventId: string, options: { phone?: string } = {}): Promise<StartEventCheckoutResult> {
  const id = eventIdSchema.safeParse(eventId)
  const phone = phoneSchema.safeParse(options.phone)
  if (!id.success) return { ok: false, error: 'This event is no longer available.' }
  if (!phone.success) return { ok: false, error: PHONE_INVALID_MESSAGE, needsPhone: true }
  try {
    const user = await requireAwsUser()
    if (!await userCan(user.id, 'event.attend')) {
      return { ok: false, error: 'Your account cannot attend events right now.' }
    }
    const { customer, invalidPhone } = await loadCheckoutCustomer(user, phone.data)
    if (invalidPhone) return { ok: false, error: PHONE_INVALID_MESSAGE, needsPhone: true }
    const checkout = await eventPaymentService.startCheckout({ profileId: user.id, eventId: id.data, customer })
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
    if (!(error instanceof EventRegistrationError) && !(error instanceof PaymentsNotConfiguredError)) {
      console.error('event_checkout_start_failed', { message: error instanceof Error ? error.message : null })
    }
    return { ok: false, error: checkoutError(error) }
  }
}

function confirmResult(outcome: EventConfirmOutcome): ConfirmEventPaymentResult {
  const amount = formatMoney(outcome.order.amountMinor, outcome.order.currency)
  switch (outcome.state) {
    case 'registered':
      return { ok: true, state: 'paid', message: `Payment of ${amount} received. Your seat is confirmed.` }
    case 'refunded':
      return {
        ok: false,
        state: 'refunded',
        error: `Your payment was received but we could not confirm a seat. ${refundReasonLabel(outcome.order.refundDueReason)} The full amount has been refunded to your original payment method.`,
      }
    case 'refund_due':
      return {
        ok: false,
        state: 'refund_due',
        error: `Your payment was received but we could not confirm a seat. ${refundReasonLabel(outcome.reason)} The Sea N Shore team will refund the full amount.`,
      }
    case 'processing':
      return { ok: false, state: 'processing', error: `Your bank hasn't confirmed the payment of ${amount} yet. Your seat is confirmed automatically as soon as it does — refresh this page in a minute to check.` }
    case 'failed':
      return { ok: false, state: 'failed', error: `The payment didn't go through${outcome.message ? `: ${outcome.message.replace(/\.$/, '')}` : ''}. No money was taken. You can try again or use a different payment method.` }
    case 'expired':
      return { ok: false, state: 'expired', error: 'This checkout expired before it was paid. No money was taken. Select Pay again to start a new checkout.' }
    case 'not_paid':
    default:
      return { ok: false, state: 'not_paid', error: 'Payment window closed before the payment was made. No money was taken. You can try again whenever you are ready.' }
  }
}

/**
 * The browser says checkout finished. The server asks the gateway (Get Order / Get
 * Payments) and only a paid answer confirms the seat.
 */
export async function confirmEventPaymentAction(input: {
  eventId: string
  orderId: string
  proof?: { providerPaymentId?: string; signature?: string } | null
}): Promise<ConfirmEventPaymentResult> {
  const parsed = confirmSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, state: 'error', error: 'We could not confirm this payment. If money was taken, your seat will be confirmed automatically within a few minutes.' }
  }
  try {
    const user = await requireAwsUser()
    const outcome = await eventPaymentService.confirmCheckout({
      profileId: user.id,
      orderId: parsed.data.orderId,
      proof: parsed.data.proof ?? undefined,
    })
    refreshEventPaths(parsed.data.eventId)
    return confirmResult(outcome)
  } catch (error) {
    if (error instanceof PaymentVerificationError) {
      return { ok: false, state: 'error', error: 'We could not verify this payment with the payment provider. If money was taken, your seat will be confirmed automatically within a few minutes, or the amount will be refunded.' }
    }
    if (error instanceof PaymentsNotConfiguredError) return { ok: false, state: 'error', error: PAYMENTS_NOT_CONFIGURED_MESSAGE }
    if (error instanceof EventRegistrationError && error.code === 'order_not_found') {
      return { ok: false, state: 'error', error: 'We could not find this checkout. Refresh the page — if money was taken, your seat is confirmed automatically within a few minutes.' }
    }
    console.error('event_checkout_confirm_failed', { message: error instanceof Error ? error.message : null })
    return { ok: false, state: 'error', error: 'We could not confirm your seat just now. If money was taken, your seat will be confirmed automatically within a few minutes. Refresh this page to check.' }
  }
}

/**
 * Refund one paid ticket in full through the gateway that took the payment.
 * Allowed for the event's host, the organization's event managers and platform admins.
 * The seat is released and the organiser's earning for it is reversed.
 */
export async function refundEventPaymentAction(orderId: string): Promise<RefundEventPaymentResult> {
  const id = z.string().uuid().safeParse(orderId)
  if (!id.success) return { ok: false, error: 'We could not find this payment. Refresh the page and try again.' }
  try {
    const user = await requireAwsUser()
    const managed = await eventPaymentRepository.getOrderForManager(id.data, user.id)
    const isAdmin = managed ? false : await canAccessPlatformAdmin(user.id)
    const order = managed ?? (isAdmin ? await eventPaymentRepository.getOrderById(id.data) : null)
    if (!order) return { ok: false, error: 'Only the event organiser or the Sea N Shore team can refund this payment.' }

    const result = await eventPaymentService.refundOrder({
      orderId: order.id,
      actor: { type: isAdmin ? 'admin' : 'organizer', profileId: user.id },
      reason: isAdmin ? 'admin_refund' : 'organizer_refund',
    })
    if (order.eventId) refreshEventPaths(order.eventId)
    const amount = formatMoney(order.amountMinor, order.currency)
    return {
      ok: true,
      message: result.state === 'refunded'
        ? `Refunded ${amount}. The attendee's seat has been released and the money is on its way back to their original payment method.`
        : `Refund of ${amount} started. The payment provider is processing it; the attendee's seat has been released.`,
    }
  } catch (error) {
    if (error instanceof EventRegistrationError) {
      if (error.code === 'refund_in_progress') return { ok: false, error: 'A refund for this payment is already being processed. Refresh the page in a minute to see the result.' }
      if (error.code === 'refund_not_allowed') return { ok: false, error: 'This payment cannot be refunded here — it is not a completed payment, or it was already refunded.' }
      return { ok: false, error: 'We could not find this payment. Refresh the page and try again.' }
    }
    if (error instanceof PaymentsNotConfiguredError) {
      return { ok: false, error: 'The payment provider that took this payment is not connected right now, so it cannot be refunded here. Contact the Sea N Shore team.' }
    }
    if (error instanceof RefundFailedError) {
      return { ok: false, error: `The payment provider did not accept the refund${error.providerMessage ? `: ${error.providerMessage.replace(/\.$/, '')}` : ''}. Nothing was refunded. Try again later or contact the Sea N Shore team.` }
    }
    console.error('event_payment_refund_action_failed', { message: error instanceof Error ? error.message : null })
    return { ok: false, error: 'We could not refund this payment just now. Nothing was refunded. Please try again in a few minutes.' }
  }
}
