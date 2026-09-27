import { confirmCourseCheckoutForViewer, confirmCoursePaymentOrder } from './course-order-handler'
import { eventOrderHandler } from './event-order-handler'
import type { PaymentOrderHandler } from './order-handler-types'
import { purposeOfGatewayOrderId } from './order-ids'
import type { PaymentPurpose } from './types'

export type { GatewayOrderEvent, OrderHandlerResult, PaymentOrderHandler, ViewerConfirmResult } from './order-handler-types'

/**
 * Which module owns a gateway order, by its id prefix (order-ids.ts):
 *   evt_  event tickets   -> event-order-handler.ts
 *   crs_  paid courses    -> course-order-handler.ts
 *   pln_  plans           -> reserved, not handled yet
 * Razorpay's own order ids ("order_…") are always event tickets.
 */
export const ORDER_HANDLERS: Record<PaymentPurpose, PaymentOrderHandler | null> = {
  event: eventOrderHandler,
  course: { applyGatewayEvent: confirmCoursePaymentOrder, confirmForViewer: confirmCourseCheckoutForViewer },
  plan: null,
}

export function orderHandlerFor(providerOrderId: string, handlers: Record<PaymentPurpose, PaymentOrderHandler | null> = ORDER_HANDLERS) {
  if (providerOrderId.startsWith('order_')) return handlers.event
  const purpose = purposeOfGatewayOrderId(providerOrderId)
  return purpose ? handlers[purpose] : null
}
