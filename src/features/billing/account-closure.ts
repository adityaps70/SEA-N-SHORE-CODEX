import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { subscriptionRepository } from './subscription-repository'
import { NothingToCancelError, subscriptionService } from './subscription-service'

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

/**
 * Before an account is deleted: turns off auto-renew on every mandate the member set up
 * (their Creator Pro, and Organization Pro they bought for an organization), because the
 * mandate charges the member's own UPI, card or bank account. Access already paid for
 * runs to its end date. Throws when Cashfree does not confirm, so nothing is deleted
 * while a plan could still take money.
 */
export async function stopAutoRenewForClosingAccount(
  profileId: string,
  deps: {
    query?: Query
    getCheckout?: typeof subscriptionRepository.getCheckout
    cancelCheckout?: typeof subscriptionService.cancelCheckout
  } = {},
) {
  const run: Query = deps.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const getCheckout = deps.getCheckout ?? ((id: string) => subscriptionRepository.getCheckout(id))
  const cancelCheckout = deps.cancelCheckout ?? ((checkout, options) => subscriptionService.cancelCheckout(checkout, options))
  const rows = await run(
    `select id
     from public.subscription_checkouts
     where (profile_id = $1 or created_by = $1)
       and status in ('pending_approval', 'active', 'on_hold', 'paused')
     order by created_at asc`,
    [profileId],
  )
  for (const row of rows) {
    const checkout = await getCheckout(String(row.id))
    if (!checkout) continue
    try {
      await cancelCheckout(checkout, { actorProfileId: profileId, actorType: 'member', endNow: false })
    } catch (error) {
      // Already stopped (no access left to end): nothing more can be charged.
      if (!(error instanceof NothingToCancelError)) throw error
    }
  }
  return { cancelled: rows.length }
}
