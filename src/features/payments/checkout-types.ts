import type { CheckoutClient, CheckoutProof } from './types'

/**
 * Shapes shared by every checkout (events now; courses and plans later) between a
 * server action and the browser checkout (components/gateway-checkout-button.tsx).
 * Safe to import from client components.
 */

/** Checkout messages about the buyer's mobile number (Cashfree requires one). */
export const PHONE_REQUIRED_MESSAGE = 'Enter your mobile number to continue. Our payment partner needs it to send your payment receipt.'
export const PHONE_REJECTED_MESSAGE = 'Our payment partner did not accept that mobile number. No money was taken. Enter a different mobile number to continue.'
export const PHONE_INVALID_MESSAGE = 'Enter a valid mobile number: 10 digits for India (for example 98765 43210), or your full number with the country code, like +44 7700 900123.'

export type StartCheckoutResult =
  | {
      ok: true
      checkout: {
        /** Our order id; send it back to the confirm action. */
        orderId: string
        client: CheckoutClient
        prefill: { email: string | null; phone: string | null; name: string | null }
      }
    }
  /** needsPhone: ask the buyer for a mobile number, then call start again with it. */
  | { ok: false; error: string; needsPhone?: boolean }

export type ConfirmCheckoutState = 'paid' | 'processing' | 'not_paid' | 'failed' | 'refund_due' | 'refunded' | 'expired' | 'error'

export type ConfirmCheckoutResult =
  | { ok: true; state: 'paid'; message: string }
  | { ok: false; state: Exclude<ConfirmCheckoutState, 'paid'>; error: string }

export type StartCheckoutAction = (input: { phone?: string }) => Promise<StartCheckoutResult>
export type ConfirmCheckoutAction = (input: { orderId: string; proof: CheckoutProof | null }) => Promise<ConfirmCheckoutResult>
