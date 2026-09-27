import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createRazorpayGateway, razorpayConfirmation, signaturesMatch } from './razorpay'
import { PaymentProviderError, PaymentVerificationError } from './types'

const config = { keyId: 'rzp_test_AbC123', keySecret: 'key-secret-value', webhookSecret: 'webhook-secret-value' }

function sign(secret: string, payload: string) {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function headers(values: Record<string, string>) {
  return new Headers(values)
}

const customer = { id: '11111111-1111-4111-8111-111111111111', email: 'officer@example.com', phone: null, name: 'Capt. Rao' }
const checkoutInput = {
  gatewayOrderId: 'evt_0f7e5b1c111141118111111111111111',
  amountMinor: 49900,
  currency: 'INR' as const,
  customer,
  description: 'Paid masterclass',
  returnUrl: null,
  notifyUrl: null,
  expiresAt: new Date('2030-01-01T10:30:00.000Z'),
  notes: { sns_order_id: 'x' },
}

describe('Razorpay gateway', () => {
  it('creates an order with Basic auth and the exact amount, currency and receipt', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'order_123', amount: 49900, currency: 'INR', status: 'created' }))
    const gateway = createRazorpayGateway(config, fetchMock)

    await expect(gateway.createCheckout(checkoutInput)).resolves.toEqual({
      providerOrderId: 'order_123',
      providerSessionId: null,
      client: { provider: 'razorpay', providerOrderId: 'order_123', keyId: 'rzp_test_AbC123', amountMinor: 49900, currency: 'INR' },
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.razorpay.com/v1/orders')
    expect(init.method).toBe('POST')
    const sent = init.headers as Record<string, string>
    expect(sent.Authorization).toBe(`Basic ${Buffer.from('rzp_test_AbC123:key-secret-value').toString('base64')}`)
    expect(JSON.parse(String(init.body))).toEqual({
      amount: 49900,
      currency: 'INR',
      receipt: 'evt_0f7e5b1c111141118111111111111111',
      notes: { sns_order_id: 'x' },
    })
  })

  it('rejects an order response that does not match what was requested', async () => {
    const gateway = createRazorpayGateway(config, async () => jsonResponse({ id: 'order_123', amount: 100, currency: 'INR' }))
    await expect(gateway.createCheckout(checkoutInput)).rejects.toMatchObject({ code: 'provider_response_invalid' })
  })

  it('reports gateway errors without exposing credentials', async () => {
    const gateway = createRazorpayGateway(config, async () => jsonResponse({ error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' } }, 401))
    const failure = await gateway.createCheckout(checkoutInput).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(PaymentProviderError)
    expect(failure).toMatchObject({ code: 'provider_request_failed', status: 401, providerMessage: 'Authentication failed' })
    expect(String((failure as Error).message)).not.toContain(config.keySecret)

    const offline = createRazorpayGateway(config, async () => { throw new Error('ECONNRESET') })
    await expect(offline.fetchPayment('pay_1')).rejects.toMatchObject({ code: 'provider_unreachable' })
  })

  it('accepts a genuine checkout signature and rejects tampered ones', () => {
    const gateway = createRazorpayGateway(config)
    const signature = sign(config.keySecret, 'order_123|pay_456')
    expect(gateway.verifyCheckoutSignature({ providerOrderId: 'order_123', providerPaymentId: 'pay_456', signature })).toBe(true)
    expect(gateway.verifyCheckoutSignature({ providerOrderId: 'order_123', providerPaymentId: 'pay_999', signature })).toBe(false)
    expect(gateway.verifyCheckoutSignature({ providerOrderId: 'order_other', providerPaymentId: 'pay_456', signature })).toBe(false)
    expect(gateway.verifyCheckoutSignature({ providerOrderId: 'order_123', providerPaymentId: 'pay_456', signature: sign('wrong-secret', 'order_123|pay_456') })).toBe(false)
    expect(gateway.verifyCheckoutSignature({ providerOrderId: 'order_123', providerPaymentId: 'pay_456', signature: 'not-hex' })).toBe(false)
    expect(gateway.verifyCheckoutSignature({ providerOrderId: 'order_123', providerPaymentId: 'pay_456', signature: '' })).toBe(false)
  })

  it('verifies webhook bodies against the webhook secret, byte for byte', () => {
    const gateway = createRazorpayGateway(config)
    const body = JSON.stringify({ event: 'payment.captured', payload: {} })
    expect(gateway.verifyWebhook(body, headers({ 'x-razorpay-signature': sign(config.webhookSecret, body) }))).toBe(true)
    expect(gateway.verifyWebhook(`${body} `, headers({ 'x-razorpay-signature': sign(config.webhookSecret, body) }))).toBe(false)
    expect(gateway.verifyWebhook(body, headers({ 'x-razorpay-signature': sign(config.keySecret, body) }))).toBe(false)
    expect(gateway.verifyWebhook(body, headers({}))).toBe(false)
    expect(gateway.verifyWebhook('', headers({ 'x-razorpay-signature': sign(config.webhookSecret, '') }))).toBe(false)
  })

  it('confirms an order from its payments and captures an authorised payment first', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/capture')) return jsonResponse({ id: 'pay_1', amount: 49900, currency: 'INR', status: 'captured', order_id: 'order_1' })
      return jsonResponse({ items: [{ id: 'pay_1', amount: 49900, currency: 'INR', status: 'authorized', order_id: 'order_1', created_at: 2 }] })
    })
    const gateway = createRazorpayGateway(config, fetchMock)
    await expect(gateway.confirmOrder('order_1')).resolves.toMatchObject({
      status: 'paid', providerPaymentId: 'pay_1', amountMinor: 49900, currency: 'INR',
    })
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://api.razorpay.com/v1/orders/order_1/payments',
      'https://api.razorpay.com/v1/payments/pay_1/capture',
    ])
  })

  it('refuses browser evidence with a forged signature before calling Razorpay', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }))
    const gateway = createRazorpayGateway(config, fetchMock)
    await expect(gateway.confirmOrder('order_1', { providerPaymentId: 'pay_1', signature: 'a'.repeat(64) }))
      .rejects.toBeInstanceOf(PaymentVerificationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('normalizes failed and unfinished attempts', () => {
    expect(razorpayConfirmation('order_1', [])).toMatchObject({ status: 'pending', lastAttempt: 'none' })
    expect(razorpayConfirmation('order_1', [
      { providerPaymentId: 'pay_1', providerOrderId: 'order_1', amountMinor: 1, currency: 'INR', status: 'failed', errorDescription: 'Card declined', createdAt: 1 },
    ])).toMatchObject({ status: 'failed', failureMessage: 'Card declined' })
  })

  it('refunds with our refund id as the receipt', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'rfnd_1', entity: 'refund', status: 'processed' }))
    const gateway = createRazorpayGateway(config, fetchMock)
    await expect(gateway.refund({
      providerOrderId: 'order_1', providerPaymentId: 'pay_1', amountMinor: 49900, currency: 'INR', refundId: 'rf1234', note: 'event_full',
    })).resolves.toEqual({ providerRefundId: 'rfnd_1', status: 'processed' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.razorpay.com/v1/payments/pay_1/refund')
    expect(JSON.parse(String(init.body))).toEqual({ amount: 49900, receipt: 'rf1234', notes: { reason: 'event_full' } })
  })

  it('never exposes a secret in what it returns', () => {
    const gateway = createRazorpayGateway(config)
    expect(JSON.stringify(gateway)).not.toContain(config.keySecret)
    expect(JSON.stringify(gateway)).not.toContain(config.webhookSecret)
    expect(JSON.stringify(gateway.restoreCheckout({ providerOrderId: 'order_1', providerSessionId: null, amountMinor: 1, currency: 'INR' }))).not.toContain(config.keySecret)
  })

  it('compares signatures in constant time only when lengths match', () => {
    const expected = sign('s', 'p')
    expect(signaturesMatch(expected, expected.toUpperCase())).toBe(true)
    expect(signaturesMatch(expected, expected.slice(2))).toBe(false)
    expect(signaturesMatch(expected, undefined)).toBe(false)
  })
})
