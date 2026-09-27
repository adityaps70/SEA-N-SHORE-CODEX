import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ handle: vi.fn(), revalidatePath: vi.fn() }))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/payouts/payout-runtime', () => ({ handlePayoutWebhook: mocks.handle }))

import { PaymentVerificationError } from '@/features/payments/types'
import { POST } from './route'

function request(body = '{"type":"TRANSFER_SUCCESS"}', headers: Record<string, string> = {}) {
  return new Request('https://example.com/api/payouts/cashfree/webhook', { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('POST /api/payouts/cashfree/webhook', () => {
  it('passes the raw body and headers to the handler and answers 200 when handled', async () => {
    mocks.handle.mockResolvedValue({ status: 'handled', type: 'TRANSFER_SUCCESS', payoutId: 'p', changed: true })
    const response = await POST(request('{"raw":1.10}', { 'x-webhook-signature': 'sig', 'x-webhook-timestamp': '1790000000000' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status: 'handled' })
    const input = mocks.handle.mock.calls[0]![0]
    expect(input.rawBody).toBe('{"raw":1.10}')
    expect(input.headers.get('x-webhook-signature')).toBe('sig')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/payments/payouts')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('answers 200 for duplicates and ignored events without refreshing pages', async () => {
    mocks.handle.mockResolvedValue({ status: 'duplicate', type: 'TRANSFER_SUCCESS' })
    expect((await POST(request())).status).toBe(200)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('answers 400 for a bad signature, 503 when not set up and 500 so Cashfree retries on errors', async () => {
    mocks.handle.mockRejectedValueOnce(new PaymentVerificationError())
    expect((await POST(request())).status).toBe(400)
    mocks.handle.mockResolvedValueOnce(null)
    expect((await POST(request())).status).toBe(503)
    mocks.handle.mockRejectedValueOnce(new Error('db down'))
    const failed = await POST(request())
    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({ ok: false, error: 'processing_failed' })
  })

  it('refuses oversized bodies', async () => {
    const response = await POST(request('x'.repeat(200 * 1024)))
    expect(response.status).toBe(413)
    expect(mocks.handle).not.toHaveBeenCalled()
  })
})
