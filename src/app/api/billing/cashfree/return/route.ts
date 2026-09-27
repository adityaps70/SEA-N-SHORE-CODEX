import { z } from 'zod'
import { subscriptionRepository } from '@/features/billing/subscription-repository'
import { subscriptionService } from '@/features/billing/subscription-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Where Cashfree sends the customer after they approve (or abandon) an auto-pay
 * mandate: /api/billing/cashfree/return?checkout=<our checkout id>. Cashfree uses an
 * HTTP POST form for this, so GET and POST are both accepted.
 *
 * The posted fields are never trusted (the docs say they may be missing in production).
 * We re-read the mandate from Cashfree server to server, apply it, and send the customer
 * to their billing page, which shows the stored status. No sign-in is needed here: a
 * cross-site POST carries no session cookie, and the step only reconciles with Cashfree.
 */

function redirectTo(path: string) {
  // A relative Location keeps the customer on whichever host they came from.
  return new Response(null, { status: 303, headers: { Location: path, 'Cache-Control': 'private, no-store' } })
}

async function handle(request: Request) {
  const url = new URL(request.url)
  const id = z.string().uuid().safeParse(url.searchParams.get('checkout'))
  if (!id.success) return redirectTo('/settings/billing')

  let checkout = null
  try {
    checkout = await subscriptionRepository.getCheckout(id.data)
  } catch (error) {
    console.error('billing_return_lookup_failed', { message: error instanceof Error ? error.message : null })
    return redirectTo('/settings/billing')
  }
  if (!checkout) return redirectTo('/settings/billing')

  try {
    await subscriptionService.refreshCheckout(checkout.id, { force: true })
  } catch (error) {
    // The billing page shows "we couldn't check yet"; webhooks and the billing job finish it.
    console.error('billing_return_refresh_failed', { message: error instanceof Error ? error.message : null })
  }

  const base = checkout.subject.kind === 'profile'
    ? '/settings/billing'
    : `/settings/billing/organizations/${checkout.subject.companyId}`
  return redirectTo(`${base}?checkout=${encodeURIComponent(checkout.id)}`)
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}
