import { describe, expect, it, vi } from 'vitest'
import {
  CASHFREE_API_VERSION,
  cashfreeConfirmation,
  cashfreeCustomerPhone,
  createCashfreeClient,
  createCashfreeGateway,
  mapCashfreePayment,
  mapCashfreeRefundStatus,
  verifyCashfreeSignature,
  type CashfreeOrder,
} from './cashfree'
import { PaymentProviderError } from './types'

const config = { clientId: 'TEST10123456789', clientSecret: 'cfsk_ma_test_secret', environment: 'sandbox' as const, international: false }
const orderId = 'evt_0f7e5b1c111141118111111111111111'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function orderEntity(overrides: Record<string, unknown> = {}) {
  return {
    cf_order_id: '2149460581',
    order_id: orderId,
    entity: 'order',
    order_amount: 499.5,
    order_currency: 'INR',
    order_status: 'ACTIVE',
    payment_session_id: 'session_abc123',
    ...overrides,
  }
}

const checkoutInput = {
  gatewayOrderId: orderId,
  amountMinor: 49950,
  currency: 'INR' as const,
  customer: { id: '11111111-1111-4111-8111-111111111111', email: 'officer@example.com', phone: '+919876543210', name: 'Capt. Rao' },
  description: 'Paid masterclass',
  returnUrl: `https://seanshore.example/payments/return?order=${orderId}`,
  notifyUrl: 'https://seanshore.example/api/payments/cashfree/webhook',
  expiresAt: new Date('2030-01-01T10:30:00.123Z'),
  notes: { sns_order_id: '0f7e5b1c-1111-4111-8111-111111111111' },
}

describe('Cashfree client', () => {
  it('creates an order on the sandbox with the pinned API version and exact rupee amount', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(orderEntity()))
    const gateway = createCashfreeGateway(config, fetchMock)
    await expect(gateway.createCheckout(checkoutInput)).resolves.toEqual({
      providerOrderId: orderId,
      providerSessionId: 'session_abc123',
      client: { provider: 'cashfree', providerOrderId: orderId, paymentSessionId: 'session_abc123', mode: 'sandbox' },
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://sandbox.cashfree.com/pg/orders')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['x-api-version']).toBe(CASHFREE_API_VERSION)
    expect(CASHFREE_API_VERSION).toBe('2026-01-01')
    expect(headers['x-client-id']).toBe(config.clientId)
    expect(headers['x-client-secret']).toBe(config.clientSecret)
    expect(headers['x-idempotency-key']).toBe(orderId)
    const body = JSON.parse(String(init.body))
    expect(body).toEqual({
      order_id: orderId,
      order_amount: 499.5,
      order_currency: 'INR',
      customer_details: {
        customer_id: '11111111111141118111111111111111',
        customer_phone: '9876543210',
        customer_email: 'officer@example.com',
        customer_name: 'Capt. Rao',
      },
      order_meta: {
        return_url: `https://seanshore.example/payments/return?order=${orderId}`,
        notify_url: 'https://seanshore.example/api/payments/cashfree/webhook',
      },
      order_expiry_time: '2030-01-01T10:30:00Z',
      order_note: 'Paid masterclass',
      order_tags: { sns_order_id: '0f7e5b1c-1111-4111-8111-111111111111' },
    })
    // The raw JSON must carry the decimal amount, not paise.
    expect(String(init.body)).toContain('"order_amount":499.5')
  })

  it('uses the production host only when configured for production', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(orderEntity()))
    await createCashfreeGateway({ ...config, environment: 'production' }, fetchMock).createCheckout(checkoutInput)
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://api.cashfree.com/pg/orders')
  })

  it('refuses to create an order without a phone number, and never sends a non-https notify URL', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(orderEntity()))
    const gateway = createCashfreeGateway(config, fetchMock)
    await expect(gateway.createCheckout({ ...checkoutInput, customer: { ...checkoutInput.customer, phone: null } }))
      .rejects.toMatchObject({ providerMessage: 'customer_phone_required' })
    expect(fetchMock).not.toHaveBeenCalled()

    await gateway.createCheckout({ ...checkoutInput, notifyUrl: 'http://localhost:3000/api/payments/cashfree/webhook', returnUrl: null })
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body.order_meta).toEqual({})
  })

  it('reuses an order that already exists (HTTP 409) when it matches', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (
      init?.method === 'POST' ? jsonResponse({ message: 'order with same id is already present', code: 'order_already_exists' }, 409) : jsonResponse(orderEntity())
    ))
    const gateway = createCashfreeGateway(config, fetchMock)
    await expect(gateway.createCheckout(checkoutInput)).resolves.toMatchObject({ providerSessionId: 'session_abc123' })
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe(`https://sandbox.cashfree.com/pg/orders/${orderId}`)
  })

  it('rejects an order whose amount differs from what was asked', async () => {
    const gateway = createCashfreeGateway(config, async () => jsonResponse(orderEntity({ order_amount: 1 })))
    await expect(gateway.createCheckout(checkoutInput)).rejects.toMatchObject({ code: 'provider_response_invalid' })
  })

  it('reports Cashfree errors and network failures without leaking the secret', async () => {
    const gateway = createCashfreeGateway(config, async () => jsonResponse({ message: 'authentication Failed', code: 'request_failed', type: 'authentication_error' }, 401))
    const failure = await gateway.createCheckout(checkoutInput).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(PaymentProviderError)
    expect(failure).toMatchObject({ code: 'provider_request_failed', status: 401, providerMessage: 'authentication Failed' })
    expect(JSON.stringify(failure)).not.toContain(config.clientSecret)

    const offline = createCashfreeGateway(config, async () => { throw new Error('ECONNRESET') })
    await expect(offline.confirmOrder(orderId)).rejects.toMatchObject({ code: 'provider_unreachable' })
  })

  it('refuses ids that are not ours before building a URL', async () => {
    const client = createCashfreeClient(config, vi.fn())
    await expect(client.getOrder('../refunds')).rejects.toMatchObject({ providerMessage: 'order_id_invalid' })
  })
})

describe('Cashfree order confirmation', () => {
  const order = (status: string): CashfreeOrder => ({ cfOrderId: '1', orderId, orderStatus: status, amountMinor: 49950, currency: 'INR', paymentSessionId: 's' })
  const payment = (status: string, time = '2030-01-01T10:05:00+05:30', extra: Record<string, unknown> = {}) => mapCashfreePayment({
    cf_payment_id: `cf_${status}_${time}`,
    order_id: orderId,
    payment_status: status,
    payment_amount: 499.5,
    payment_currency: 'INR',
    payment_time: time,
    ...extra,
  })!

  it('counts an order as paid only when Cashfree says PAID with a SUCCESS payment', async () => {
    const fetchMock = vi.fn(async (url: string) => (
      url.endsWith('/payments')
        ? jsonResponse([
            { cf_payment_id: 111, order_id: orderId, payment_status: 'FAILED', payment_amount: 499.5, payment_currency: 'INR', payment_time: '2030-01-01T10:01:00+05:30' },
            { cf_payment_id: '1453995084705707520', order_id: orderId, payment_status: 'SUCCESS', payment_amount: 499.5, payment_currency: 'INR', payment_time: '2030-01-01T10:02:00+05:30' },
          ])
        : jsonResponse(orderEntity({ order_status: 'PAID' }))
    ))
    const gateway = createCashfreeGateway(config, fetchMock)
    await expect(gateway.confirmOrder(orderId)).resolves.toEqual({
      status: 'paid',
      providerOrderId: orderId,
      providerPaymentId: '1453995084705707520',
      amountMinor: 49950,
      currency: 'INR',
      lastAttempt: 'succeeded',
      failureMessage: null,
    })
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `https://sandbox.cashfree.com/pg/orders/${orderId}`,
      `https://sandbox.cashfree.com/pg/orders/${orderId}/payments`,
    ])
  })

  it('does not treat a SUCCESS attempt on an order that is not PAID as paid', () => {
    expect(cashfreeConfirmation(order('ACTIVE'), [payment('SUCCESS')])).toMatchObject({ status: 'pending', lastAttempt: 'processing' })
  })

  it('reports pending, dropped, failed and expired orders plainly', () => {
    expect(cashfreeConfirmation(order('ACTIVE'), [])).toMatchObject({ status: 'pending', lastAttempt: 'none' })
    expect(cashfreeConfirmation(order('ACTIVE'), [payment('PENDING')])).toMatchObject({ status: 'pending', lastAttempt: 'processing' })
    expect(cashfreeConfirmation(order('ACTIVE'), [payment('USER_DROPPED')])).toMatchObject({ status: 'pending', lastAttempt: 'dropped' })
    expect(cashfreeConfirmation(order('ACTIVE'), [
      payment('SUCCESS', '2030-01-01T09:00:00+05:30'),
      payment('FAILED', '2030-01-01T10:00:00+05:30', { error_details: { error_description: 'Insufficient balance in account' } }),
    ].slice(1))).toMatchObject({ status: 'failed', failureMessage: 'Insufficient balance in account' })
    expect(cashfreeConfirmation(order('EXPIRED'), [])).toMatchObject({ status: 'cancelled' })
    expect(cashfreeConfirmation(order('TERMINATED'), [])).toMatchObject({ status: 'cancelled' })
  })

  it('maps refund statuses', () => {
    expect(mapCashfreeRefundStatus('SUCCESS')).toBe('processed')
    expect(mapCashfreeRefundStatus('PENDING')).toBe('pending')
    expect(mapCashfreeRefundStatus('ONHOLD')).toBe('pending')
    expect(mapCashfreeRefundStatus('CANCELLED')).toBe('failed')
    expect(mapCashfreeRefundStatus('REJECTED')).toBe('failed')
  })

  it('creates a refund with our refund id and the exact rupee amount', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ cf_refund_id: '17461', refund_id: 'rf0f7e5b1c1111411181111111111111111', refund_status: 'PENDING' }))
    const gateway = createCashfreeGateway(config, fetchMock)
    await expect(gateway.refund({
      providerOrderId: orderId,
      providerPaymentId: '1453995084705707520',
      amountMinor: 49950,
      currency: 'INR',
      refundId: 'rf0f7e5b1c1111411181111111111111111',
      note: 'Sea N Shore event ticket refund',
    })).resolves.toEqual({ providerRefundId: '17461', status: 'pending' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://sandbox.cashfree.com/pg/orders/${orderId}/refunds`)
    expect(JSON.parse(String(init.body))).toEqual({ refund_amount: 499.5, refund_id: 'rf0f7e5b1c1111411181111111111111111', refund_note: 'Sea N Shore event ticket refund' })
  })
})

describe('Cashfree webhook signature', () => {
  const rawBody = '{"data":{"order":{"order_id":"evt_0f7e5b1c111141118111111111111111","order_amount":499.5}},"type":"PAYMENT_SUCCESS_WEBHOOK"}'
  const timestamp = '1785401067911'
  // Base64(HMAC-SHA256(secret, timestamp + rawBody)), computed independently.
  const vector = 'jbPAH8ufIFOZLlSmwXcfIcOEmMPHpxN6KU8rwOgAVmY='

  it('accepts the documented recipe: timestamp + raw body, base64 HMAC-SHA256 with the client secret', () => {
    expect(verifyCashfreeSignature({ secret: config.clientSecret, rawBody, timestamp, signature: vector })).toBe(true)
    const gateway = createCashfreeGateway(config, vi.fn())
    expect(gateway.verifyWebhook(rawBody, new Headers({ 'x-webhook-timestamp': timestamp, 'x-webhook-signature': vector }))).toBe(true)
  })

  it('rejects a dot separator, a changed body, another secret, or missing headers', () => {
    // Signature of timestamp + "." + body: the PHP-style reading the docs warn about.
    expect(verifyCashfreeSignature({ secret: config.clientSecret, rawBody, timestamp, signature: 'mc1OIQd7Mf8aG88NoyZv/CEnF5NTz6F4J45IrFDmiaE=' })).toBe(false)
    expect(verifyCashfreeSignature({ secret: config.clientSecret, rawBody: rawBody.replace('499.5', '499.50'), timestamp, signature: vector })).toBe(false)
    expect(verifyCashfreeSignature({ secret: 'other-secret', rawBody, timestamp, signature: vector })).toBe(false)
    expect(verifyCashfreeSignature({ secret: config.clientSecret, rawBody, timestamp: '1785401067912', signature: vector })).toBe(false)
    expect(verifyCashfreeSignature({ secret: config.clientSecret, rawBody, timestamp: null, signature: vector })).toBe(false)
    expect(verifyCashfreeSignature({ secret: config.clientSecret, rawBody, timestamp, signature: null })).toBe(false)
    expect(verifyCashfreeSignature({ secret: config.clientSecret, rawBody, timestamp, signature: 'short' })).toBe(false)
    expect(verifyCashfreeSignature({ secret: config.clientSecret, rawBody: '', timestamp, signature: vector })).toBe(false)
  })

  it('applies an age limit only when one is asked for', () => {
    const now = Number(timestamp) + 60 * 60_000
    expect(verifyCashfreeSignature({ secret: config.clientSecret, rawBody, timestamp, signature: vector, now })).toBe(true)
    expect(verifyCashfreeSignature({ secret: config.clientSecret, rawBody, timestamp, signature: vector, now, maxAgeMs: 10 * 60_000 })).toBe(false)
  })
})

describe('Cashfree customer phone', () => {
  it('sends Indian mobiles as 10 digits and other countries with +', () => {
    expect(cashfreeCustomerPhone('+919876543210')).toBe('9876543210')
    expect(cashfreeCustomerPhone('+447700900123')).toBe('+447700900123')
  })
})
