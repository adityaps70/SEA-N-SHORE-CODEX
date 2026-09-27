import { query, withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { loadCashfreePayoutsConfig } from '@/features/payments/cashfree-config'
import { createPayoutService } from './payout-service'
import { createPayoutWebhookHandler } from './payout-webhook'

/** Non-transactional reads through the shared pool, shaped like a transaction client. */
export const readClient: DatabaseQueryClient = {
  async query(text, values) {
    return { rows: await query(text, values) }
  },
} as DatabaseQueryClient

export const payoutService = createPayoutService({
  transaction: withTransaction,
  read: readClient,
  loadConfig: () => loadCashfreePayoutsConfig(),
})

export const handlePayoutWebhook = createPayoutWebhookHandler({
  loadConfig: () => loadCashfreePayoutsConfig(),
  transaction: withTransaction,
})

/** Payouts are "on" only when the Cashfree Payouts key pair is configured. */
export async function arePayoutsConfigured() {
  try {
    return Boolean(await loadCashfreePayoutsConfig())
  } catch {
    return false
  }
}

export async function payoutsEnvironment() {
  try {
    return (await loadCashfreePayoutsConfig())?.environment ?? null
  } catch {
    return null
  }
}
