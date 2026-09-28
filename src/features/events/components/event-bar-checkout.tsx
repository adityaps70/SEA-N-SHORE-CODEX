'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { GatewayCheckoutButton } from '@/features/payments/components/gateway-checkout-button'
import { confirmEventPaymentAction, startEventCheckoutAction } from '@/features/payments/event-payment-actions'
import { CHECKOUT_TIMEOUT_SECONDS, PAYMENTS_NOT_CONFIGURED_MESSAGE } from '@/features/payments/event-payment-rules'

/**
 * "Pay ₹x and register" for the phone sticky bar: the same checkout as EventCheckoutButton,
 * without the small print (the page keeps it) and shaped as the bar's filled pill.
 */
export function EventBarCheckout({
  eventId,
  eventTitle,
  priceLabel,
  paymentsConfigured,
  blockedMessage,
}: {
  eventId: string
  eventTitle: string
  priceLabel: string
  paymentsConfigured: boolean
  blockedMessage?: string
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const payable = paymentsConfigured && !blockedMessage
  // Re-shapes only the checkout's own top-level button; its phone-number step keeps its styles.
  const pill = '[&>div>button]:min-h-12 [&>div>button]:rounded-full [&>div>button]:text-[15px]'
  const filled = payable ? '[&>div>button]:bg-ocean-700 [&>div>button]:hover:bg-ocean-800 [&>div>button]:focus-visible:outline-ocean-500' : ''
  return (
    <div className={`min-w-0 flex-1 ${pill} ${filled}`}>
      <GatewayCheckoutButton
        actionLabel={`Pay ${priceLabel} and register`}
        description={eventTitle}
        configured={paymentsConfigured}
        notConfiguredLabel={PAYMENTS_NOT_CONFIGURED_MESSAGE}
        disabled={Boolean(blockedMessage)}
        unavailableLabel={blockedMessage ? 'Tickets not on sale yet' : undefined}
        successFallback="Payment received. Your seat is confirmed."
        timeoutSeconds={CHECKOUT_TIMEOUT_SECONDS}
        start={({ phone }) => startEventCheckoutAction(eventId, phone ? { phone } : {})}
        confirm={({ orderId, proof }) => confirmEventPaymentAction({ eventId, orderId, proof })}
        onSettled={() => startTransition(() => router.refresh())}
      />
    </div>
  )
}
