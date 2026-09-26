'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { userCan } from '@/features/access/server'
import { EventRegistrationError } from './event-payment-repository'
import { PAYMENTS_NOT_CONFIGURED_MESSAGE, refundReasonLabel, registrationBlockerMessage } from './event-payment-rules'
import {
  createEventPaymentService,
  PaymentGatewayUnavailableError,
  PaymentsNotConfiguredError,
  PaymentVerificationError,
  type CheckoutSession,
} from './event-payment-service'
import { getPaymentProvider } from './provider'

export type StartEventCheckoutResult =
  | { ok: true; checkout: CheckoutSession & { prefill: { email: string | null } } }
  | { ok: false; error: string }

export type ConfirmEventPaymentResult =
  | { ok: true; state: 'registered' }
  | { ok: false; state: 'refund_due' | 'refunded' | 'error'; error: string }

const eventIdSchema = z.string().uuid()
const confirmSchema = z.object({
  eventId: z.string().uuid(),
  orderId: z.string().uuid(),
  providerOrderId: z.string().trim().min(1).max(100),
  providerPaymentId: z.string().trim().min(1).max(100),
  signature: z.string().trim().min(1).max(200),
})

const service = createEventPaymentService({ getProvider: getPaymentProvider })

function refreshEventPaths(eventId: string) {
  revalidatePath('/events')
  revalidatePath('/events/my')
  revalidatePath('/events/hosting')
  revalidatePath(`/events/${eventId}`)
  revalidatePath(`/events/${eventId}/registrations`)
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

export async function startEventCheckoutAction(eventId: string): Promise<StartEventCheckoutResult> {
  const id = eventIdSchema.safeParse(eventId)
  if (!id.success) return { ok: false, error: 'This event is no longer available.' }
  try {
    const user = await requireAwsUser()
    if (!await userCan(user.id, 'event.attend')) {
      return { ok: false, error: 'Your account cannot attend events right now.' }
    }
    const checkout = await service.startCheckout({ profileId: user.id, eventId: id.data })
    return { ok: true, checkout: { ...checkout, prefill: { email: user.email } } }
  } catch (error) {
    if (!(error instanceof EventRegistrationError) && !(error instanceof PaymentsNotConfiguredError)) {
      console.error('event_checkout_start_failed', { message: error instanceof Error ? error.message : null })
    }
    return { ok: false, error: checkoutError(error) }
  }
}

export async function confirmEventPaymentAction(input: {
  eventId: string
  orderId: string
  providerOrderId: string
  providerPaymentId: string
  signature: string
}): Promise<ConfirmEventPaymentResult> {
  const parsed = confirmSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, state: 'error', error: 'We could not confirm this payment. If money was taken, your seat will be confirmed automatically within a few minutes.' }
  }
  try {
    const user = await requireAwsUser()
    const outcome = await service.confirmCheckout({
      profileId: user.id,
      orderId: parsed.data.orderId,
      providerOrderId: parsed.data.providerOrderId,
      providerPaymentId: parsed.data.providerPaymentId,
      signature: parsed.data.signature,
    })
    refreshEventPaths(parsed.data.eventId)
    if (outcome.state === 'registered') return { ok: true, state: 'registered' }
    if (outcome.state === 'refunded') {
      return {
        ok: false,
        state: 'refunded',
        error: `Your payment was received but we could not confirm a seat. ${refundReasonLabel(outcome.order.refundDueReason)} The full amount has been refunded to your original payment method.`,
      }
    }
    return {
      ok: false,
      state: 'refund_due',
      error: `Your payment was received but we could not confirm a seat. ${refundReasonLabel(outcome.reason)} The Sea N Shore team will refund the full amount.`,
    }
  } catch (error) {
    if (error instanceof PaymentVerificationError) {
      return { ok: false, state: 'error', error: 'We could not verify this payment with the payment provider. If money was taken, your seat will be confirmed automatically within a few minutes, or the amount will be refunded.' }
    }
    if (error instanceof PaymentsNotConfiguredError) return { ok: false, state: 'error', error: PAYMENTS_NOT_CONFIGURED_MESSAGE }
    console.error('event_checkout_confirm_failed', { message: error instanceof Error ? error.message : null })
    return { ok: false, state: 'error', error: 'We could not confirm your seat just now. If money was taken, your seat will be confirmed automatically within a few minutes. Refresh this page to check.' }
  }
}
