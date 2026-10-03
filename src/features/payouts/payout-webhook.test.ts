import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))

import { PaymentVerificationError } from '@/features/payments/types'
import { createPayout } from './payout-repository'
import { parsePayoutWebhook, createPayoutWebhookHandler } from './payout-webhook'
import { account, ADMIN_ID, createLedger, earning, SELLER_ID } from './test-ledger'
import type { DatabaseQueryClient } from '@/lib/db/client'

const PAYOUT_ID = '77777777-7777-4777-8777-777777777777'
const TRANSFER_ID = 'snspo_77777777777747778777777777777777'
const E1 = 'e1111111-1111-4111-8111-111111111111'
const config = { clientId: 'id', clientSecret: 'payouts_secret', publicKeyPem: null, environment: 'sandbox' as const }

function body(type: string, data: Record<string, unknown>) {
  return JSON.stringify({ data: { transfer_id: TRANSFER_ID, cf_transfer_id: 'CF9', transfer_amount: 449.1, updated_on: '2026-09-27T12:00:00', ...data }, event_time: '2026-09-27T12:00:01', type })
}

function signed(rawBody: string, secret = 'payouts_secret', timestamp = '1790000000000') {
  const signature = createHmac('sha256', secret).update(timestamp + rawBody).digest('base64')
  return new Headers({ 'x-webhook-timestamp': timestamp, 'x-webhook-signature': signature })
}

async function setup() {
  const db = createLedger({ accounts: [account()], earnings: [earning(E1, { net_minor: 44910 })] })
  await createPayout(db.client, { payoutId: PAYOUT_ID, seller: { profileId: SELLER_ID }, earningIds: [E1], expectedTotalMinor: 44910, minPayoutMinor: 10000, actorProfileId: ADMIN_ID })
  const deliveries = new Set<string>()
  // recordWebhookDelivery's insert, answered here on top of the ledger.
  const transaction = async <T,>(work: (tx: DatabaseQueryClient) => Promise<T>) => work({
    query: async (sql: string, values?: readonly unknown[]) => {
      if (sql.includes('insert into public.payment_webhook_events')) {
        const id = String(values?.[1])
        if (deliveries.has(id)) return { rows: [] }
        deliveries.add(id)
        return { rows: [{ provider_event_id: id }] }
      }
      return db.client.query(sql, values)
    },
  } as DatabaseQueryClient)
  const handler = createPayoutWebhookHandler({ loadConfig: async () => config, transaction })
  return { db, handler, deliveries }
}

describe('parsePayoutWebhook', () => {
  it('reads the v2 transfer payload into a report', () => {
    const parsed = parsePayoutWebhook(body('TRANSFER_SUCCESS', { status: 'SUCCESS', status_code: 'COMPLETED', transfer_utr: 'UTR555' }))
    expect(parsed).toMatchObject({
      type: 'TRANSFER_SUCCESS',
      transferId: TRANSFER_ID,
      report: { status: 'SUCCESS', statusCode: 'COMPLETED', utr: 'UTR555', cfTransferId: 'CF9', amountMinor: 44910 },
    })
    expect(parsed?.deliveryId).toBe(`payouts:TRANSFER_SUCCESS:${TRANSFER_ID}:SUCCESS:2026-09-27T12:00:00`)
  })

  it('falls back to the event type for the status and ignores other events', () => {
    expect(parsePayoutWebhook(body('TRANSFER_REVERSED', {}))?.report?.status).toBe('REVERSED')
    expect(parsePayoutWebhook(body('TRANSFER_ACKNOWLEDGED', {}))?.report?.status).toBe('PENDING')
    expect(parsePayoutWebhook(body('LOW_BALANCE_ALERT', {}))?.report).toBeNull()
    expect(parsePayoutWebhook('not json')).toBeNull()
  })
})

describe('payout webhook handler', () => {
  it('rejects a bad signature before reading the body', async () => {
    const { handler, db } = await setup()
    const raw = body('TRANSFER_SUCCESS', { status: 'SUCCESS' })
    await expect(handler({ rawBody: raw, headers: signed(raw, 'wrong_secret') })).rejects.toBeInstanceOf(PaymentVerificationError)
    await expect(handler({ rawBody: raw, headers: new Headers() })).rejects.toBeInstanceOf(PaymentVerificationError)
    expect(db.ledger.payouts[0]!.status).toBe('draft')
  })

  it('returns null (503) when payouts are not configured', async () => {
    const handler = createPayoutWebhookHandler({ loadConfig: async () => null, transaction: vi.fn() })
    expect(await handler({ rawBody: '{}', headers: new Headers() })).toBeNull()
  })

  it('marks the payout paid once, even when Cashfree delivers twice', async () => {
    const { handler, db } = await setup()
    const raw = body('TRANSFER_SUCCESS', { status: 'SUCCESS', transfer_utr: 'UTR555' })
    expect(await handler({ rawBody: raw, headers: signed(raw) })).toEqual({ status: 'handled', type: 'TRANSFER_SUCCESS', payoutId: PAYOUT_ID, changed: true })
    expect(db.ledger.payouts[0]).toMatchObject({ status: 'success', utr: 'UTR555' })
    expect(db.ledger.earnings[0]!.status).toBe('paid')
    expect(await handler({ rawBody: raw, headers: signed(raw) })).toEqual({ status: 'duplicate', type: 'TRANSFER_SUCCESS' })
  })

  it('releases the earnings on TRANSFER_FAILED', async () => {
    const { handler, db } = await setup()
    const raw = body('TRANSFER_FAILED', { status: 'FAILED', status_description: 'Invalid beneficiary account' })
    await handler({ rawBody: raw, headers: signed(raw) })
    expect(db.ledger.payouts[0]).toMatchObject({ status: 'failed', failure_reason: 'Invalid beneficiary account' })
    expect(db.ledger.earnings[0]).toMatchObject({ status: 'available', payout_id: null })
  })

  it('ignores transfers that are not Sea N Shore payouts and unknown payouts', async () => {
    const { handler } = await setup()
    const foreign = JSON.stringify({ data: { transfer_id: 'manual_123', status: 'SUCCESS' }, type: 'TRANSFER_SUCCESS' })
    expect(await handler({ rawBody: foreign, headers: signed(foreign) })).toMatchObject({ status: 'ignored', reason: 'not_a_payout' })
    const unknown = JSON.stringify({ data: { transfer_id: 'snspo_00000000000040008000000000000000', status: 'SUCCESS' }, type: 'TRANSFER_SUCCESS' })
    expect(await handler({ rawBody: unknown, headers: signed(unknown) })).toMatchObject({ status: 'ignored', reason: 'unknown_payout' })
  })

  it('does not apply a webhook with a different amount', async () => {
    const { handler, db } = await setup()
    const raw = body('TRANSFER_SUCCESS', { status: 'SUCCESS', transfer_amount: 1 })
    expect(await handler({ rawBody: raw, headers: signed(raw) })).toMatchObject({ status: 'handled', changed: false })
    expect(db.ledger.payouts[0]!.status).toBe('draft')
  })
})
