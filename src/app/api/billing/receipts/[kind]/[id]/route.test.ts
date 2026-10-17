import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'

const mocks = vi.hoisted(() => ({
  getVerifiedUser: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.getVerifiedUser }))
vi.mock('@/lib/db/client', () => ({ query: mocks.query, withTransaction: vi.fn() }))

import { GET } from './route'

const payerId = '11111111-1111-4111-8111-111111111111'
const paymentId = '22222222-2222-4222-8222-222222222222'

const subscriptionRow = {
  id: paymentId, amount_minor: '9900', currency: 'INR', status: 'success', paid_at: '2026-10-01T06:30:00.000Z',
  plan_code: 'creator_pro', billing_interval: 'month', cf_payment_id: 'cf_1', payer_name: 'Placeholder Member', company_name: null,
}

function get(kind: string, id = paymentId) {
  return GET(new Request(`https://seanshore.example/api/billing/receipts/${kind}/${id}`), { params: Promise.resolve({ kind, id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getVerifiedUser.mockResolvedValue({ id: payerId })
  mocks.query.mockResolvedValue([subscriptionRow])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/billing/receipts/[kind]/[id] (Round H, H7)', () => {
  it('asks signed-out visitors to sign in', async () => {
    mocks.getVerifiedUser.mockResolvedValue(null)
    const response = await get('subscription')
    expect(response.status).toBe(401)
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown kind or an id that is not a UUID, without reading anything', async () => {
    expect((await get('course')).status).toBe(404)
    expect((await get('subscription', 'not-a-uuid')).status).toBe(404)
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('returns 404 when the viewer did not pay and does not run the organization (the ownership query finds nothing)', async () => {
    mocks.getVerifiedUser.mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333' })
    mocks.query.mockResolvedValueOnce([])
    const response = await get('subscription')
    expect(response.status).toBe(404)
    expect(mocks.query.mock.calls[0]![1]).toEqual([paymentId, '33333333-3333-4333-8333-333333333333'])
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('gives the payer a private payment-receipt PDF', async () => {
    const response = await get('subscription')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="SNS-R-22222222.pdf"')
    const pdf = await PDFDocument.load(new Uint8Array(await response.arrayBuffer()))
    expect(pdf.getSubject()).toBe('Payment receipt (not a tax invoice)')
    expect(mocks.query.mock.calls[0]![1]).toEqual([paymentId, payerId])
  })

  it('serves event tickets to their buyer only', async () => {
    mocks.query.mockResolvedValueOnce([{ id: paymentId, event_title: 'Placeholder Summit', amount_minor: '150000', currency: 'INR', status: 'paid', paid_at: '2026-10-01T06:30:00.000Z', provider_payment_id: 'pay_1', payer_name: 'Placeholder Member' }])
    expect((await get('event')).status).toBe(200)
    expect(mocks.query.mock.calls[0]![0]).toMatch(/e\.profile_id = \$2::uuid/)
    mocks.query.mockResolvedValueOnce([])
    expect((await get('event')).status).toBe(404)
  })

  it('reports a failure without leaking details', async () => {
    mocks.query.mockRejectedValueOnce(new Error('database down'))
    const response = await get('subscription')
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('The receipt could not be created. Please try again.')
  })
})
