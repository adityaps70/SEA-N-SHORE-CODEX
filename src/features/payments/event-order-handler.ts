import { formatMoney } from './currency'
import { refundReasonLabel } from './event-payment-rules'
import { eventPaymentService } from './event-payment-runtime'
import type { EventConfirmOutcome } from './event-payment-service'
import type { PaymentOrderHandler, ViewerConfirmResult } from './order-handler-types'

/** Plain-language result of an event ticket payment, for the return page. */
export function eventViewerResult(outcome: EventConfirmOutcome | null): ViewerConfirmResult {
  if (!outcome) {
    return {
      state: 'not_found',
      title: 'We could not find this payment',
      message: 'This payment link is not linked to your account. If money was taken, your seat is confirmed automatically within a few minutes — check My events.',
      returnHref: '/events/my',
      returnLabel: 'Go to My events',
    }
  }
  const { order } = outcome
  const amount = formatMoney(order.amountMinor, order.currency)
  const returnHref = order.eventId ? `/events/${order.eventId}` : '/events/my'
  const returnLabel = order.eventId ? 'Back to the event' : 'Go to My events'
  const base = { returnHref, returnLabel }
  switch (outcome.state) {
    case 'registered':
      return { ...base, state: 'paid', title: 'Payment received — your seat is confirmed', message: `We received ${amount} for ${order.eventTitle}. You'll find the event in My events.` }
    case 'refunded':
      return { ...base, state: 'refunded', title: 'Your payment was refunded', message: `We received ${amount} but could not confirm a seat. ${refundReasonLabel(order.refundDueReason)} The full amount is on its way back to your original payment method (usually 5–7 working days).` }
    case 'refund_due':
      return { ...base, state: 'refund_due', title: 'Payment received, seat not confirmed', message: `We received ${amount} but could not confirm a seat. ${refundReasonLabel(outcome.reason)} The Sea N Shore team will refund the full amount.` }
    case 'processing':
      return { ...base, state: 'processing', title: 'Waiting for your bank', message: `Your bank has not confirmed the payment of ${amount} yet. This usually takes a minute. Check again shortly — if it goes through, your seat is confirmed automatically.` }
    case 'failed':
      return { ...base, state: 'failed', title: "The payment didn't go through", message: `${outcome.message ? `${outcome.message.replace(/\.$/, '')}. ` : ''}No money was taken. Go back to the event to try again or use a different payment method.` }
    case 'expired':
      return { ...base, state: 'expired', title: 'This checkout has expired', message: 'No money was taken. Go back to the event and start again to pay.' }
    case 'not_paid':
    default:
      return { ...base, state: 'not_paid', title: 'No payment was made', message: 'The payment was not completed, so no money was taken. Go back to the event to try again.' }
  }
}

/** Event tickets ("evt_" gateway orders). */
export const eventOrderHandler: PaymentOrderHandler = {
  applyGatewayEvent: (tx, event) => eventPaymentService.applyGatewayEvent(tx, event),
  async confirmForViewer(input) {
    return eventViewerResult(await eventPaymentService.confirmByProviderOrderId(input))
  },
}
