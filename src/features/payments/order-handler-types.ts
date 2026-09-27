import type { DatabaseQueryClient } from '@/lib/db/client'
import type { PaymentProviderName } from './types'

/**
 * Contract between the gateway webhooks / return page and each kind of order
 * (events, courses, plans). A handler never trusts the browser: webhook events are
 * signature-verified before they reach it, and confirmForViewer must ask the gateway.
 */

/** A verified gateway event about one of our orders, already normalized. Amounts in minor units. */
export type GatewayOrderEvent =
  | {
      kind: 'payment_succeeded'
      provider: PaymentProviderName
      providerOrderId: string
      providerPaymentId: string
      amountMinor: number | null
      currency: string | null
      occurredAt: string | null
    }
  | {
      kind: 'payment_failed'
      provider: PaymentProviderName
      providerOrderId: string
      providerPaymentId: string | null
      /** Gateway's plain reason, safe to store (no card data). */
      reason: string
      /** True when the buyer left the checkout rather than the bank declining. */
      dropped: boolean
    }
  | {
      kind: 'refund_updated'
      provider: PaymentProviderName
      providerOrderId: string
      providerPaymentId: string | null
      providerRefundId: string
      /** Our refund id (order-ids.ts refundIdFor), when the gateway echoes it. */
      refundId: string | null
      amountMinor: number | null
      status: 'processed' | 'pending' | 'failed'
    }

export type OrderHandlerResult = {
  handled: boolean
  /** Why nothing changed, e.g. 'order_unknown', 'not_implemented'. For logs only. */
  reason?: string
  /**
   * Work to run after the webhook transaction commits, such as calling the gateway
   * to refund a payment that could not be fulfilled. Failures are logged; they do
   * not make the gateway retry the webhook.
   */
  afterCommit?: () => Promise<void>
  /** App paths to refresh after the change (revalidatePath). */
  revalidatePaths?: string[]
}

/** What the /payments/return page shows after asking the gateway. */
export type ViewerConfirmResult = {
  state: 'paid' | 'processing' | 'not_paid' | 'failed' | 'refund_due' | 'refunded' | 'expired' | 'not_found'
  title: string
  message: string
  /** Where "Continue" goes, e.g. the event or course page. */
  returnHref: string
  returnLabel: string
}

export type PaymentOrderHandler = {
  /** Applies a verified webhook event inside the webhook's transaction `tx`. Must be idempotent. */
  applyGatewayEvent(tx: DatabaseQueryClient, event: GatewayOrderEvent): Promise<OrderHandlerResult>
  /**
   * The signed-in buyer came back from checkout. Check they own the order, confirm it
   * with the gateway server to server, apply the result, and say what happened.
   */
  confirmForViewer(input: { profileId: string; providerOrderId: string }): Promise<ViewerConfirmResult>
}
