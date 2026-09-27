import type { QueryResultRow } from 'pg'
import type { DatabaseQueryClient } from '@/lib/db/client'
import type { PaymentProviderName } from './types'

/**
 * Records a webhook delivery in public.payment_webhook_events inside the caller's
 * transaction. Returns false when this delivery was already processed (gateways
 * deliver at least once). If the transaction rolls back, the record goes with it,
 * so the gateway's retry is processed afresh.
 */
export async function recordWebhookDelivery(client: DatabaseQueryClient, provider: PaymentProviderName, deliveryId: string, eventType: string) {
  const result = await client.query<QueryResultRow>(`
    insert into public.payment_webhook_events (provider, provider_event_id, event_type)
    values ($1::text, $2::text, $3::text)
    on conflict (provider, provider_event_id) do nothing
    returning provider_event_id
  `, [provider, deliveryId.slice(0, 200), eventType.slice(0, 120)])
  return Boolean(result.rows[0])
}
