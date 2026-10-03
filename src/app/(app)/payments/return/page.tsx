import type { Metadata } from 'next'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { PaymentReturnView, type PaymentReturnResult } from '@/features/payments/components/payment-return-view'
import { isGatewayOrderId } from '@/features/payments/order-ids'
import { orderHandlerFor } from '@/features/payments/order-handlers'

export const metadata: Metadata = { title: 'Payment status' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const NOT_FOUND: PaymentReturnResult = {
  state: 'not_found',
  title: 'We could not find this payment',
  message: 'This link does not match a payment on your account. If money was taken, it is confirmed automatically within a few minutes.',
  returnHref: '/home',
  returnLabel: 'Go to Home',
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Where the payment gateway sends the buyer after a redirect-based payment
 * (/payments/return?order=<gateway order id>). The page never trusts the URL: it asks
 * the gateway server to server through the order's handler, then sends the buyer on.
 */
export default async function PaymentReturnPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireAwsUser()
  const params = await searchParams
  const providerOrderId = first(params.order) ?? first(params.order_id) ?? ''
  const handler = isGatewayOrderId(providerOrderId) ? orderHandlerFor(providerOrderId) : null

  let result: PaymentReturnResult = NOT_FOUND
  if (handler) {
    try {
      result = await handler.confirmForViewer({ profileId: user.id, providerOrderId })
    } catch (error) {
      console.error('payment_return_confirm_failed', { message: error instanceof Error ? error.message : null })
      result = {
        state: 'error',
        title: 'We could not check your payment yet',
        message: 'The payment service did not answer just now. If money was taken, it is confirmed automatically within a few minutes. Check again shortly.',
        returnHref: '/home',
        returnLabel: 'Go to Home',
      }
    }
  }

  return (
    <div className="py-6 sm:py-10">
      <PaymentReturnView
        result={result}
        checkAgainHref={handler ? `/payments/return?order=${encodeURIComponent(providerOrderId)}` : null}
      />
    </div>
  )
}
