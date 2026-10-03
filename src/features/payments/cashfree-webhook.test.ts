import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))

import { createCashfreeWebhookHandler, parseCashfreeWebhook } from './cashfree-webhook'
import type { PaymentOrderHandler } from './order-handler-types'
import { PaymentVerificationError, type PaymentGateway } from './types'

const orderId = 'evt_33333333333343338333333333333333'

/** Shapes follow the 2026-01-01 samples in the Cashfree docs. */
const success = {
  data: {
    order: { order_id: orderId, order_amount: 499.5, order_currency: 'INR', order_tags: null },
    payment: {
      cf_payment_id: '1453995084705707520',
      payment_status: 'SUCCESS',
      payment_amount: 499.5,
      payment_currency: 'INR',
      payment_message: 'Transaction Success',
      payment_time: '2026-09-17T11:47:22+05:30',
      bank_reference: '1234567890',
      payment_method: { netbanking: { channel: null, netbanking_bank_code: '3333', netbanking_bank_name: 'TEST Bank' } },
      payment_group: 'net_banking',
    },
    customer_details: { customer_name: 'Capt. Rao', customer_id: '1111', customer_email: 'officer@example.com', customer_phone: '9876543210' },
    payment_gateway_details: { gateway_name: 'CASHFREE' },
  },
  event_time: '2026-09-17T11:47:29+05:30',
  type: 'PAYMENT_SUCCESS_WEBHOOK',
}

describe('parsing Cashfree webhooks', () => {
  it('normalizes a successful payment with the exact paise amount', () => {
    expect(parseCashfreeWebhook(JSON.stringify(success))).toEqual({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      fallbackDeliveryId: 'PAYMENT_SUCCESS_WEBHOOK:1453995084705707520',
      event: {
        kind: 'payment_succeeded',
        provider: 'cashfree',
        providerOrderId: orderId,
        providerPaymentId: '1453995084705707520',
        amountMinor: 49950,
        currency: 'INR',
        occurredAt: '2026-09-17T11:47:22+05:30',
      },
    })
  })

  it('reads the failure reason wherever Cashfree puts error_details, and flags dropped checkouts', () => {
    const failed = { ...success, type: 'PAYMENT_FAILED_WEBHOOK', data: { ...success.data, payment: { ...success.data.payment, payment_status: 'FAILED' }, error_details: { error_code: 'GATEWAY_ERROR', error_description: 'Bank declined the payment' } } }
    expect(parseCashfreeWebhook(JSON.stringify(failed))?.event).toMatchObject({ kind: 'payment_failed', reason: 'Bank declined the payment', dropped: false })
    const nested = { ...success, type: 'PAYMENT_FAILED_WEBHOOK', data: { ...success.data, payment: { ...success.data.payment, payment_status: 'FAILED', error_details: { error_description: 'Insufficient funds' } } } }
    expect(parseCashfreeWebhook(JSON.stringify(nested))?.event).toMatchObject({ reason: 'Insufficient funds' })
    const dropped = { ...success, type: 'PAYMENT_USER_DROPPED_WEBHOOK', data: { ...success.data, payment: { ...success.data.payment, payment_status: 'USER_DROPPED' } } }
    expect(parseCashfreeWebhook(JSON.stringify(dropped))?.event).toMatchObject({ kind: 'payment_failed', dropped: true })
  })

  it('does not treat a "success" webhook with another status as paid', () => {
    const odd = { ...success, data: { ...success.data, payment: { ...success.data.payment, payment_status: 'PENDING' } } }
    expect(parseCashfreeWebhook(JSON.stringify(odd))?.event).toBeNull()
  })

  it('normalizes refund updates and ignores events it does not need', () => {
    const refund = {
      data: { refund: { cf_refund_id: '17461', cf_payment_id: '1453995084705707520', refund_id: 'rf3333', order_id: orderId, refund_amount: 499.5, refund_currency: 'INR', refund_status: 'SUCCESS' } },
      event_time: '2026-09-18T10:00:00+05:30',
      type: 'REFUND_STATUS_WEBHOOK',
    }
    expect(parseCashfreeWebhook(JSON.stringify(refund))).toMatchObject({
      fallbackDeliveryId: 'REFUND_STATUS_WEBHOOK:17461:SUCCESS',
      event: { kind: 'refund_updated', providerRefundId: '17461', refundId: 'rf3333', amountMinor: 49950, status: 'processed' },
    })
    expect(parseCashfreeWebhook(JSON.stringify({ ...success, type: 'PAYMENT_CHARGES_WEBHOOK' }))?.event).toBeNull()
    expect(parseCashfreeWebhook('{not json')).toBeNull()
  })
})

describe('handling Cashfree webhooks', () => {
  function setup(options: { verified?: boolean; handler?: Partial<PaymentOrderHandler> | null } = {}) {
    const seen = new Set<string>()
    const client = {
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes('insert into public.payment_webhook_events')) {
          const key = `${values[0]}:${values[1]}`
          if (seen.has(key)) return { rows: [] }
          seen.add(key)
          return { rows: [{ provider_event_id: values[1] }] }
        }
        return { rows: [] }
      }),
    }
    const transaction = vi.fn(async <T,>(fn: (tx: typeof client) => Promise<T>) => fn(client))
    const handler: PaymentOrderHandler = {
      applyGatewayEvent: vi.fn(async () => ({ handled: true, revalidatePaths: ['/events/x'] })),
      confirmForViewer: vi.fn(),
      ...options.handler,
    }
    const gateway = { verifyWebhook: vi.fn(() => options.verified ?? true) } as unknown as PaymentGateway
    const log = vi.fn()
    const handle = createCashfreeWebhookHandler({
      getGateway: async () => gateway,
      resolveHandler: (id) => (options.handler === null ? null : id.startsWith('evt_') ? handler : null),
      transaction: transaction as never,
      log,
    })
    return { handle, handler, client, transaction, log }
  }

  const headers = new Headers({ 'x-webhook-timestamp': '1785401067911', 'x-webhook-signature': 'sig', 'x-idempotency-key': 'idem-1' })
  const rawBody = JSON.stringify(success)

  it('refuses an unverified body before parsing or touching the database', async () => {
    const { handle, transaction } = setup({ verified: false })
    await expect(handle({ rawBody, headers })).rejects.toBeInstanceOf(PaymentVerificationError)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('routes evt_ orders to the event handler inside one transaction with the delivery record', async () => {
    const { handle, handler, client } = setup()
    await expect(handle({ rawBody, headers })).resolves.toEqual({ status: 'handled', type: 'PAYMENT_SUCCESS_WEBHOOK', revalidatePaths: ['/events/x'] })
    expect(handler.applyGatewayEvent).toHaveBeenCalledWith(client, expect.objectContaining({ kind: 'payment_succeeded', amountMinor: 49950 }))
    const delivery = client.query.mock.calls.find((call) => String(call[0]).includes('payment_webhook_events'))
    expect(delivery?.[1]).toEqual(['cashfree', 'PAYMENT_SUCCESS_WEBHOOK:idem-1', 'PAYMENT_SUCCESS_WEBHOOK'])
  })

  it('processes a retried delivery only once', async () => {
    const { handle, handler } = setup()
    await handle({ rawBody, headers })
    await expect(handle({ rawBody, headers })).resolves.toEqual({ status: 'duplicate', type: 'PAYMENT_SUCCESS_WEBHOOK' })
    expect(handler.applyGatewayEvent).toHaveBeenCalledTimes(1)
  })

  it('de-duplicates on type and payment id when the idempotency header is missing', async () => {
    const { handle, client } = setup()
    await handle({ rawBody, headers: new Headers({ 'x-webhook-timestamp': '1', 'x-webhook-signature': 'sig' }) })
    const delivery = client.query.mock.calls.find((call) => String(call[0]).includes('payment_webhook_events'))
    expect((delivery?.[1] as unknown[])[1]).toBe('PAYMENT_SUCCESS_WEBHOOK:1453995084705707520')
  })

  it('acknowledges unknown order prefixes and unneeded events without a database write', async () => {
    const { handle, transaction } = setup({ handler: null })
    await expect(handle({ rawBody, headers })).resolves.toMatchObject({ status: 'ignored', reason: 'unknown_order_prefix' })
    await expect(handle({ rawBody: JSON.stringify({ ...success, type: 'PAYMENT_CHARGES_WEBHOOK' }), headers })).resolves.toMatchObject({ status: 'ignored' })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('runs after-commit work (automatic refunds) and logs its failure without failing the webhook', async () => {
    const afterCommit = vi.fn(async () => { throw new Error('refund_failed') })
    const { handle, log } = setup({ handler: { applyGatewayEvent: vi.fn(async () => ({ handled: true, afterCommit })) } })
    await expect(handle({ rawBody, headers })).resolves.toMatchObject({ status: 'handled' })
    expect(afterCommit).toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('cashfree_webhook_after_commit_failed', expect.objectContaining({ type: 'PAYMENT_SUCCESS_WEBHOOK' }))
  })

  it('lets a database failure propagate so the route answers 5xx and Cashfree retries', async () => {
    const { handle } = setup({ handler: { applyGatewayEvent: vi.fn(async () => { throw new Error('connection reset') }) } })
    await expect(handle({ rawBody, headers })).rejects.toThrow('connection reset')
  })
})
