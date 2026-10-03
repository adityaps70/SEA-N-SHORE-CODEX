import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handleWebhook: vi.fn(),
  refreshCheckout: vi.fn(),
  runSweep: vi.fn(),
  getCheckout: vi.fn(),
  revalidatePath: vi.fn(),
  pgHandler: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/billing/subscription-service', () => ({
  subscriptionService: { handleWebhook: mocks.handleWebhook, refreshCheckout: mocks.refreshCheckout, runSweep: mocks.runSweep },
}))
vi.mock('@/features/billing/subscription-repository', () => ({ subscriptionRepository: { getCheckout: mocks.getCheckout } }))
vi.mock('@/features/payments/cashfree-webhook', () => ({ createCashfreeWebhookHandler: () => mocks.pgHandler }))
vi.mock('@/features/payments/order-handlers', () => ({ orderHandlerFor: () => null }))
vi.mock('@/features/payments/provider', () => ({ getGatewayByName: async () => null }))

import { PaymentVerificationError } from '@/features/payments/types'
import { POST as pgWebhook } from '@/app/api/payments/cashfree/webhook/route'
import { POST as jobs } from './jobs/route'
import { GET as returnGet, POST as returnPost } from './return/route'
import { POST as webhook } from './webhook/route'

const checkoutId = '0f7e5b1c-1111-4111-8111-111111111111'
const companyId = '55555555-5555-4555-8555-555555555555'

function webhookRequest(body: unknown, url = 'https://seanshore.example/api/billing/cashfree/webhook') {
  return new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'x-webhook-timestamp': '1785401067911', 'x-webhook-signature': 'sig' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.BILLING_JOBS_SECRET
})

describe('POST /api/billing/cashfree/webhook', () => {
  it('passes the raw body and headers to the verified handler and refreshes billing pages', async () => {
    mocks.handleWebhook.mockResolvedValue({ status: 'handled', type: 'SUBSCRIPTION_STATUS_CHANGED', changed: true, revalidatePaths: ['/settings/billing'] })
    const response = await webhook(webhookRequest({ type: 'SUBSCRIPTION_STATUS_CHANGED', data: {} }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, status: 'handled' })
    const input = mocks.handleWebhook.mock.calls[0]![0]
    expect(input.rawBody).toBe('{"type":"SUBSCRIPTION_STATUS_CHANGED","data":{}}')
    expect(input.headers.get('x-webhook-signature')).toBe('sig')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/settings/billing')
  })

  it('answers 400 for a bad signature, 503 when not set up and 500 so Cashfree retries failures', async () => {
    mocks.handleWebhook.mockRejectedValueOnce(new PaymentVerificationError())
    expect((await webhook(webhookRequest({}))).status).toBe(400)
    mocks.handleWebhook.mockResolvedValueOnce(null)
    expect((await webhook(webhookRequest({}))).status).toBe(503)
    mocks.handleWebhook.mockRejectedValueOnce(new Error('db down'))
    expect((await webhook(webhookRequest({}))).status).toBe(500)
  })

  it('refuses oversized bodies before reading them', async () => {
    const request = new Request('https://seanshore.example/api/billing/cashfree/webhook', { method: 'POST', body: 'x', headers: { 'content-length': String(10 * 1024 * 1024) } })
    expect((await webhook(request)).status).toBe(413)
    expect(mocks.handleWebhook).not.toHaveBeenCalled()
  })
})

describe('the Payment Gateway webhook endpoint', () => {
  it('hands subscription events to billing and keeps order events for payments', async () => {
    mocks.handleWebhook.mockResolvedValue({ status: 'handled', type: 'SUBSCRIPTION_PAYMENT_SUCCESS', changed: true, revalidatePaths: [] })
    const subscription = await pgWebhook(webhookRequest({ type: 'SUBSCRIPTION_PAYMENT_SUCCESS', data: {} }, 'https://seanshore.example/api/payments/cashfree/webhook'))
    expect(subscription.status).toBe(200)
    expect(mocks.handleWebhook).toHaveBeenCalledTimes(1)
    expect(mocks.pgHandler).not.toHaveBeenCalled()

    mocks.pgHandler.mockResolvedValue({ status: 'ignored', type: 'PAYMENT_SUCCESS_WEBHOOK', reason: 'x' })
    await pgWebhook(webhookRequest({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: {} }, 'https://seanshore.example/api/payments/cashfree/webhook'))
    expect(mocks.pgHandler).toHaveBeenCalledTimes(1)
    expect(mocks.handleWebhook).toHaveBeenCalledTimes(1)
  })
})

describe('/api/billing/cashfree/return', () => {
  it('accepts Cashfree’s POST, re-checks with Cashfree and sends the member to their billing page', async () => {
    mocks.getCheckout.mockResolvedValue({ id: checkoutId, subject: { kind: 'profile', profileId: 'p1' } })
    mocks.refreshCheckout.mockResolvedValue({ id: checkoutId, status: 'active' })
    const form = new URLSearchParams({ cf_subscriptionId: '123', cf_status: 'ACTIVE' })
    const response = await returnPost(new Request(`https://seanshore.example/api/billing/cashfree/return?checkout=${checkoutId}`, { method: 'POST', body: form }))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`/settings/billing?checkout=${checkoutId}`)
    expect(mocks.refreshCheckout).toHaveBeenCalledWith(checkoutId, { force: true })
  })

  it('sends organization checkouts back to the organization billing page, even if Cashfree is slow', async () => {
    mocks.getCheckout.mockResolvedValue({ id: checkoutId, subject: { kind: 'company', companyId } })
    mocks.refreshCheckout.mockRejectedValue(new Error('provider_unreachable'))
    const response = await returnGet(new Request(`https://seanshore.example/api/billing/cashfree/return?checkout=${checkoutId}`))
    expect(response.headers.get('location')).toBe(`/settings/billing/organizations/${companyId}?checkout=${checkoutId}`)
  })

  it('ignores unknown or malformed checkouts without calling Cashfree', async () => {
    mocks.getCheckout.mockResolvedValue(null)
    const unknown = await returnGet(new Request(`https://seanshore.example/api/billing/cashfree/return?checkout=${checkoutId}`))
    expect(unknown.headers.get('location')).toBe('/settings/billing')
    const malformed = await returnPost(new Request('https://seanshore.example/api/billing/cashfree/return?checkout=../../admin', { method: 'POST' }))
    expect(malformed.headers.get('location')).toBe('/settings/billing')
    expect(mocks.refreshCheckout).not.toHaveBeenCalled()
  })
})

describe('POST /api/billing/cashfree/jobs', () => {
  const secret = 'a-very-long-random-billing-jobs-secret-value'

  it('is off until a secret is configured', async () => {
    const response = await jobs(new Request('https://seanshore.example/api/billing/cashfree/jobs', { method: 'POST' }))
    expect(response.status).toBe(503)
  })

  it('requires the bearer secret and runs the billing job', async () => {
    process.env.BILLING_JOBS_SECRET = secret
    const denied = await jobs(new Request('https://seanshore.example/api/billing/cashfree/jobs', { method: 'POST', headers: { authorization: 'Bearer wrong' } }))
    expect(denied.status).toBe(401)
    expect(mocks.runSweep).not.toHaveBeenCalled()

    mocks.runSweep.mockResolvedValue({ expired: 2, reconciled: 3, paymentsApplied: 0, chargesRaised: 0, failures: 0, configured: true })
    const ok = await jobs(new Request('https://seanshore.example/api/billing/cashfree/jobs', { method: 'POST', headers: { authorization: `Bearer ${secret}` } }))
    expect(ok.status).toBe(200)
    await expect(ok.json()).resolves.toMatchObject({ ok: true, expired: 2, reconciled: 3 })
  })
})
