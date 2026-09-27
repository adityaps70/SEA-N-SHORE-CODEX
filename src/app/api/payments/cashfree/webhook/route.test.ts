import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  gateway: null as unknown,
  revalidatePath: vi.fn(),
  applyGatewayEvent: vi.fn(),
  deliveries: new Set<string>(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/db/client', () => ({
  query: vi.fn(),
  withTransaction: async (fn: (client: unknown) => unknown) => fn({
    query: async (sql: string, values: unknown[]) => {
      if (sql.includes('payment_webhook_events')) {
        const key = String(values[1])
        if (mocks.deliveries.has(key)) return { rows: [] }
        mocks.deliveries.add(key)
        return { rows: [{ provider_event_id: key }] }
      }
      return { rows: [] }
    },
  }),
}))
vi.mock('@/features/payments/provider', () => ({
  getGatewayByName: async (name: string) => (name === 'cashfree' ? mocks.gateway : null),
}))
vi.mock('@/features/payments/order-handlers', () => ({
  orderHandlerFor: (id: string) => (id.startsWith('evt_') ? { applyGatewayEvent: mocks.applyGatewayEvent, confirmForViewer: vi.fn() } : null),
}))

import { createCashfreeGateway } from '@/features/payments/cashfree'
import { POST } from './route'

const clientSecret = 'cfsk_ma_test_secret'
const body = JSON.stringify({
  data: {
    order: { order_id: 'evt_33333333333343338333333333333333', order_amount: 499, order_currency: 'INR' },
    payment: { cf_payment_id: '1453995084705707520', payment_status: 'SUCCESS', payment_amount: 499, payment_currency: 'INR', payment_time: '2026-09-17T11:47:22+05:30' },
  },
  event_time: '2026-09-17T11:47:29+05:30',
  type: 'PAYMENT_SUCCESS_WEBHOOK',
}).replace('"payment_amount":499,', '"payment_amount":499.00,')

function sign(rawBody: string, timestamp: string, secret = clientSecret) {
  return createHmac('sha256', secret).update(timestamp + rawBody).digest('base64')
}

function request(rawBody: string, signature: string | null, extra: Record<string, string> = {}) {
  const headers = new Headers({ 'content-type': 'application/json', 'x-webhook-timestamp': '1785401067911', 'x-webhook-version': '2026-01-01', ...extra })
  if (signature) headers.set('x-webhook-signature', signature)
  return new Request('https://example.com/api/payments/cashfree/webhook', { method: 'POST', body: rawBody, headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.deliveries.clear()
  mocks.gateway = createCashfreeGateway({ clientId: 'TEST1', clientSecret, environment: 'sandbox', international: false }, vi.fn())
  mocks.applyGatewayEvent.mockResolvedValue({ handled: true, revalidatePaths: ['/events/22222222-2222-4222-8222-222222222222'] })
})

describe('POST /api/payments/cashfree/webhook', () => {
  it('verifies the signature over the raw body text (decimals untouched)', async () => {
    // JSON.parse would turn 499.00 into 499 and break the signature; the route must sign-check the raw text.
    expect(body).toContain('"payment_amount":499.00')
    const response = await POST(request(body, sign(body, '1785401067911'), { 'x-idempotency-key': 'idem-1' }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, status: 'handled' })
    expect(mocks.applyGatewayEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'payment_succeeded', amountMinor: 49900 }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/events/22222222-2222-4222-8222-222222222222')
  })

  it('answers 400 for a bad or missing signature and changes nothing', async () => {
    expect((await POST(request(body, sign(body, '1785401067911', 'wrong')))).status).toBe(400)
    expect((await POST(request(body, null))).status).toBe(400)
    expect((await POST(request(body.replace('499', '1'), sign(body, '1785401067911')))).status).toBe(400)
    expect(mocks.applyGatewayEvent).not.toHaveBeenCalled()
  })

  it('acknowledges a repeated delivery with 200 without processing it again', async () => {
    const signed = sign(body, '1785401067911')
    await POST(request(body, signed, { 'x-idempotency-key': 'idem-2' }))
    const again = await POST(request(body, signed, { 'x-idempotency-key': 'idem-2' }))
    expect(again.status).toBe(200)
    await expect(again.json()).resolves.toEqual({ ok: true, status: 'duplicate' })
    expect(mocks.applyGatewayEvent).toHaveBeenCalledTimes(1)
  })

  it('asks Cashfree to retry (500) when processing fails, and 503 while Cashfree is not set up', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.applyGatewayEvent.mockRejectedValue(new Error('connection reset'))
    expect((await POST(request(body, sign(body, '1785401067911')))).status).toBe(500)
    error.mockRestore()

    mocks.gateway = null
    expect((await POST(request(body, sign(body, '1785401067911')))).status).toBe(503)
  })

  it('refuses oversized bodies', async () => {
    const huge = 'x'.repeat(300 * 1024)
    expect((await POST(request(huge, sign(huge, '1785401067911')))).status).toBe(413)
  })
})
