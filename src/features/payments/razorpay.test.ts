import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createRazorpayProvider, signaturesMatch } from './razorpay'
import { PaymentProviderError } from './types'

const config = { keyId: 'rzp_test_AbC123', keySecret: 'key-secret-value', webhookSecret: 'webhook-secret-value' }

function sign(secret: string, payload: string) {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('Razorpay payment provider', () => {
  it('creates an order with Basic auth and the exact amount, currency and receipt', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'order_123', amount: 49900, currency: 'INR', status: 'created' }))
    const provider = createRazorpayProvider(config, fetchMock)

    await expect(provider.createOrder({
      amountMinor: 49900,
      currency: 'INR',
      receipt: '0f7e5b1c-1111-4111-8111-111111111111',
      notes: { sns_order_id: 'x' },
    })).resolves.toEqual({ providerOrderId: 'order_123', amountMinor: 49900, currency: 'INR' })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.razorpay.com/v1/orders')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('rzp_test_AbC123:key-secret-value').toString('base64')}`)
    expect(JSON.parse(String(init.body))).toEqual({
      amount: 49900,
      currency: 'INR',
      receipt: '0f7e5b1c-1111-4111-8111-111111111111',
      notes: { sns_order_id: 'x' },
    })
  })

  it('rejects an order response that does not match what was requested', async () => {
    const provider = createRazorpayProvider(config, async () => jsonResponse({ id: 'order_123', amount: 100, currency: 'INR' }))
    await expect(provider.createOrder({ amountMinor: 49900, currency: 'INR', receipt: 'r', notes: {} }))
      .rejects.toMatchObject({ code: 'provider_response_invalid' })
  })

  it('reports gateway errors without exposing credentials', async () => {
    const provider = createRazorpayProvider(config, async () => jsonResponse({ error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' } }, 401))
    const failure = await provider.createOrder({ amountMinor: 100, currency: 'INR', receipt: 'r', notes: {} }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(PaymentProviderError)
    expect(failure).toMatchObject({ code: 'provider_request_failed', status: 401, providerMessage: 'Authentication failed' })
    expect(String((failure as Error).message)).not.toContain(config.keySecret)

    const offline = createRazorpayProvider(config, async () => { throw new Error('ECONNRESET') })
    await expect(offline.fetchPayment('pay_1')).rejects.toMatchObject({ code: 'provider_unreachable' })
  })

  it('accepts a genuine checkout signature and rejects tampered ones', () => {
    const provider = createRazorpayProvider(config)
    const signature = sign(config.keySecret, 'order_123|pay_456')
    expect(provider.verifyCheckoutSignature({ providerOrderId: 'order_123', providerPaymentId: 'pay_456', signature })).toBe(true)
    expect(provider.verifyCheckoutSignature({ providerOrderId: 'order_123', providerPaymentId: 'pay_999', signature })).toBe(false)
    expect(provider.verifyCheckoutSignature({ providerOrderId: 'order_other', providerPaymentId: 'pay_456', signature })).toBe(false)
    expect(provider.verifyCheckoutSignature({ providerOrderId: 'order_123', providerPaymentId: 'pay_456', signature: sign('wrong-secret', 'order_123|pay_456') })).toBe(false)
    expect(provider.verifyCheckoutSignature({ providerOrderId: 'order_123', providerPaymentId: 'pay_456', signature: 'not-hex' })).toBe(false)
    expect(provider.verifyCheckoutSignature({ providerOrderId: 'order_123', providerPaymentId: 'pay_456', signature: '' })).toBe(false)
  })

  it('verifies webhook bodies against the webhook secret, byte for byte', () => {
    const provider = createRazorpayProvider(config)
    const body = JSON.stringify({ event: 'payment.captured', payload: {} })
    expect(provider.verifyWebhookSignature(body, sign(config.webhookSecret, body))).toBe(true)
    expect(provider.verifyWebhookSignature(`${body} `, sign(config.webhookSecret, body))).toBe(false)
    expect(provider.verifyWebhookSignature(body, sign(config.keySecret, body))).toBe(false)
    expect(provider.verifyWebhookSignature(body, null)).toBe(false)
    expect(provider.verifyWebhookSignature('', sign(config.webhookSecret, ''))).toBe(false)
  })

  it('fetches, captures and refunds payments through the REST API', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/refund')) return jsonResponse({ id: 'rfnd_1', entity: 'refund' })
      if (url.endsWith('/capture')) return jsonResponse({ id: 'pay_1', amount: 49900, currency: 'INR', status: 'captured', order_id: 'order_1' })
      return jsonResponse({ id: 'pay_1', amount: 49900, currency: 'INR', status: 'authorized', order_id: 'order_1' })
    })
    const provider = createRazorpayProvider(config, fetchMock)
    await expect(provider.fetchPayment('pay_1')).resolves.toMatchObject({ status: 'authorized', providerOrderId: 'order_1', amountMinor: 49900 })
    await expect(provider.capturePayment('pay_1', 49900, 'INR')).resolves.toMatchObject({ status: 'captured' })
    await expect(provider.refundPayment('pay_1', 49900, { reason: 'event_full' })).resolves.toEqual({ providerRefundId: 'rfnd_1' })
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://api.razorpay.com/v1/payments/pay_1',
      'https://api.razorpay.com/v1/payments/pay_1/capture',
      'https://api.razorpay.com/v1/payments/pay_1/refund',
    ])
  })

  it('exposes only the public key id', () => {
    const provider = createRazorpayProvider(config)
    expect(provider.publicKeyId).toBe('rzp_test_AbC123')
    expect(JSON.stringify(provider)).not.toContain(config.keySecret)
    expect(JSON.stringify(provider)).not.toContain(config.webhookSecret)
  })

  it('compares signatures in constant time only when lengths match', () => {
    const expected = sign('s', 'p')
    expect(signaturesMatch(expected, expected.toUpperCase())).toBe(true)
    expect(signaturesMatch(expected, expected.slice(2))).toBe(false)
    expect(signaturesMatch(expected, undefined)).toBe(false)
  })
})
