'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { confirmEventPaymentAction, startEventCheckoutAction } from '../event-payment-actions'
import { CHECKOUT_TIMEOUT_SECONDS, PAYMENTS_NOT_CONFIGURED_MESSAGE } from '../event-payment-rules'
import { GatewayCheckoutButton } from './gateway-checkout-button'

type Props = {
  eventId: string
  eventTitle: string
  priceLabel: string
  paymentsConfigured: boolean
  disabled?: boolean
  /** Shown on the button instead of the price while registration is unavailable, e.g. "Event full". */
  unavailableLabel?: string
  /** Why this event cannot be paid for right now (e.g. its currency is not accepted yet). */
  blockedMessage?: string
}

export function EventCheckoutButton({ eventId, eventTitle, priceLabel, paymentsConfigured, disabled = false, unavailableLabel, blockedMessage }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  return (
    <GatewayCheckoutButton
      actionLabel={`Pay ${priceLabel} and register`}
      description={eventTitle}
      hint="Secure payment by card, UPI or net banking. Your seat is confirmed as soon as the payment succeeds."
      configured={paymentsConfigured}
      notConfiguredLabel={PAYMENTS_NOT_CONFIGURED_MESSAGE}
      notConfiguredHelp="This is a paid event. You'll be able to buy a ticket here as soon as payments are switched on."
      disabled={disabled || Boolean(blockedMessage)}
      unavailableLabel={blockedMessage ? 'Tickets not on sale yet' : unavailableLabel}
      unavailableHelp={blockedMessage}
      successFallback="Payment received. Your seat is confirmed."
      timeoutSeconds={CHECKOUT_TIMEOUT_SECONDS}
      start={({ phone }) => startEventCheckoutAction(eventId, phone ? { phone } : {})}
      confirm={({ orderId, proof }) => confirmEventPaymentAction({ eventId, orderId, proof })}
      onSettled={() => startTransition(() => router.refresh())}
    />
  )
}
