import { z } from 'zod'
import { buildPlanBillingView, formatBillingDate } from './billing-view'
import { checkoutStateCopy, type CheckPlanCheckoutResult } from './checkout-messages'
import { PLAN_LABELS, planForSubject, type BillingSubject } from './plans'
import { subscriptionRepository, type SubscriptionRepository } from './subscription-repository'
import { subscriptionService, type SubscriptionService } from './subscription-service'
import type { CheckoutRecord } from './subscription-types'

/** Server-side data for the billing pages (Creator Pro and Organization Pro). */

function sameSubject(checkout: CheckoutRecord, subject: BillingSubject) {
  if (checkout.subject.kind === 'profile') return subject.kind === 'profile' && checkout.subject.profileId === subject.profileId
  return subject.kind === 'company' && checkout.subject.companyId === subject.companyId
}

export async function loadPlanBillingView(subject: BillingSubject, deps: {
  repository?: SubscriptionRepository
  service?: Pick<SubscriptionService, 'isConfigured'>
  now?: Date
} = {}) {
  const repository = deps.repository ?? subscriptionRepository
  const service = deps.service ?? subscriptionService
  const now = deps.now ?? new Date()
  const [billing, prices, configuration] = await Promise.all([
    repository.getSubjectBilling(subject, now),
    repository.listActivePrices(),
    service.isConfigured().catch(() => ({ configured: false as const, environment: null })),
  ])
  return buildPlanBillingView({ plan: planForSubject(subject), billing, prices, configured: configuration.configured, now })
}

/**
 * The status banner after Cashfree sends the customer back (?checkout=<id>). Read from
 * the database (the return route has just asked Cashfree), and only for the viewer's
 * own subject, so the URL alone cannot show a false "active".
 */
export async function loadCheckoutNotice(checkoutId: string | undefined, subject: BillingSubject, repository: SubscriptionRepository = subscriptionRepository): Promise<{ checkoutId: string; notice: CheckPlanCheckoutResult } | null> {
  const id = z.string().uuid().safeParse(checkoutId)
  if (!id.success) return null
  const checkout = await repository.getCheckout(id.data).catch(() => null)
  if (!checkout || !sameSubject(checkout, subject)) return null
  const planLabel = PLAN_LABELS[checkout.planCode]
  const state = checkout.status === 'active' || checkout.status === 'on_hold'
    ? 'active'
    : checkout.status === 'pending_approval'
      ? 'pending_approval'
      : checkout.status === 'failed'
        ? 'failed'
        : checkout.status === 'created'
          ? 'waiting'
          : 'closed'
  const notice = checkoutStateCopy(state, { planLabel, renewsOn: formatBillingDate(checkout.nextChargeAt) })
  if (state === 'waiting') {
    return {
      checkoutId: checkout.id,
      notice: {
        state: 'waiting',
        title: 'We haven’t received your approval yet',
        message: 'If you approved auto-pay in Cashfree, it can take a minute to reach us — check the status below. If you closed the window, no money was taken and you can start again.',
      },
    }
  }
  return { checkoutId: checkout.id, notice }
}
