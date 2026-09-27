import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  query: vi.fn(),
  txQuery: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({
  query: db.query,
  withTransaction: async (callback: (client: { query: typeof db.txQuery }) => unknown) => callback({ query: db.txQuery }),
}))

import { eventPaymentRepository } from './event-payment-repository'

const profileId = '11111111-1111-4111-8111-111111111111'
const eventId = '22222222-2222-4222-8222-222222222222'
const orderId = '33333333-3333-4333-8333-333333333333'
const now = new Date('2030-01-01T10:00:00.000Z')

const eventRow = {
  id: eventId,
  host_user_id: '44444444-4444-4444-8444-444444444444',
  title: 'Paid masterclass',
  status: 'published',
  end_at: '2030-01-05T10:00:00.000Z',
  capacity: 2,
  registration_mode: 'open',
  registration_closes_at: null,
  is_paid: true,
  price_minor: '49900',
  currency: 'INR',
}

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId,
    event_id: eventId,
    profile_id: profileId,
    event_title: 'Paid masterclass',
    amount_minor: '49900',
    currency: 'INR',
    provider: 'razorpay',
    provider_order_id: 'order_abc',
    provider_payment_id: null,
    status: 'created',
    registration_confirmed_at: null,
    refund_due_reason: null,
    created_at: '2030-01-01T09:55:00.000Z',
    ...overrides,
  }
}

type Scenario = {
  event?: Record<string, unknown> | null
  registered?: boolean
  attendees?: number
  held?: number
  openOrder?: Record<string, unknown> | null
  lockedOrder?: Record<string, unknown> | null
}

/** Answers each SQL statement by what it does, so the tests do not depend on call order. */
function scenario(input: Scenario) {
  db.txQuery.mockImplementation(async (sql: string, values: unknown[]) => {
    const text = sql.replace(/\s+/g, ' ')
    if (text.includes('from public.events where id = $1::uuid for update')) return { rows: input.event === null ? [] : [input.event ?? eventRow] }
    if (text.startsWith(' select 1 from public.event_attendees') || text.startsWith('select 1 from public.event_attendees')) return { rows: input.registered ? [{ '?column?': 1 }] : [] }
    if (text.includes('count(*)::bigint as count from public.event_attendees')) return { rows: [{ count: String(input.attendees ?? 0) }] }
    if (text.includes("status = 'created' and created_at > now()")) return { rows: [{ count: String(input.held ?? 0) }] }
    if (text.includes("o.status = 'created' for update")) return { rows: input.openOrder ? [input.openOrder] : [] }
    if (text.includes('where o.id = $1::uuid for update')) return { rows: input.lockedOrder ? [input.lockedOrder] : [] }
    if (text.includes('insert into public.event_payment_orders')) {
      return { rows: [orderRow({ provider_order_id: null, amount_minor: values[3], currency: values[4], created_at: now.toISOString() })] }
    }
    if (text.includes('set refund_due_reason')) return { rows: [orderRow({ status: 'paid', provider_payment_id: 'pay_1', refund_due_reason: values[1] })] }
    if (text.includes('set registration_confirmed_at')) return { rows: [orderRow({ status: 'paid', provider_payment_id: 'pay_1', registration_confirmed_at: now.toISOString() })] }
    return { rows: [] }
  })
}

function sqlCalls() {
  return db.txQuery.mock.calls.map((call) => String(call[0]).replace(/\s+/g, ' '))
}

beforeEach(() => {
  db.query.mockReset()
  db.txQuery.mockReset()
})

describe('event payment repository: starting checkout', () => {
  it('records a new order for the price stored on the event', async () => {
    scenario({})
    const result = await eventPaymentRepository.prepareCheckoutOrder({ profileId, eventId, provider: 'razorpay', now })
    expect(result.reused).toBe(false)
    expect(result.order).toMatchObject({ amountMinor: 49900, currency: 'INR', status: 'created' })
    const insert = db.txQuery.mock.calls.find((call) => String(call[0]).includes('insert into public.event_payment_orders'))
    expect(insert?.[1]).toEqual([eventId, profileId, 'Paid masterclass', 49900, 'INR', 'razorpay'])
    expect(sqlCalls()[0]).toContain('for update')
  })

  it('counts seats held by other open checkouts and refuses when the event is full', async () => {
    scenario({ attendees: 1, held: 1 })
    await expect(eventPaymentRepository.prepareCheckoutOrder({ profileId, eventId, provider: 'razorpay', now }))
      .rejects.toMatchObject({ code: 'event_full' })
    expect(sqlCalls().some((sql) => sql.includes('insert into public.event_payment_orders'))).toBe(false)
  })

  it('refuses when registration has closed or the attendee is already registered', async () => {
    scenario({ event: { ...eventRow, registration_closes_at: '2030-01-01T09:00:00.000Z' } })
    await expect(eventPaymentRepository.prepareCheckoutOrder({ profileId, eventId, provider: 'razorpay', now }))
      .rejects.toMatchObject({ code: 'event_registration_closed' })

    scenario({ registered: true })
    await expect(eventPaymentRepository.prepareCheckoutOrder({ profileId, eventId, provider: 'razorpay', now }))
      .rejects.toMatchObject({ code: 'already_registered' })

    scenario({ event: { ...eventRow, is_paid: false } })
    await expect(eventPaymentRepository.prepareCheckoutOrder({ profileId, eventId, provider: 'razorpay', now }))
      .rejects.toMatchObject({ code: 'event_not_paid' })
  })

  it('reuses a recent open checkout at the same price', async () => {
    scenario({ openOrder: orderRow() })
    const result = await eventPaymentRepository.prepareCheckoutOrder({ profileId, eventId, provider: 'razorpay', now })
    expect(result).toMatchObject({ reused: true, order: { id: orderId, providerOrderId: 'order_abc' } })
    expect(sqlCalls().some((sql) => sql.includes('insert into'))).toBe(false)
  })

  it('replaces an open checkout when the organiser changed the price', async () => {
    scenario({ openOrder: orderRow({ amount_minor: '29900' }) })
    const result = await eventPaymentRepository.prepareCheckoutOrder({ profileId, eventId, provider: 'razorpay', now })
    expect(result.reused).toBe(false)
    expect(sqlCalls().some((sql) => sql.includes("set status = 'cancelled', failure_reason = 'superseded'"))).toBe(true)
  })

  it('turns a concurrent duplicate checkout into a clear retry message', async () => {
    db.txQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('insert into public.event_payment_orders')) throw Object.assign(new Error('duplicate key'), { code: '23505' })
      const text = String(sql).replace(/\s+/g, ' ')
      if (text.includes('from public.events where id = $1::uuid for update')) return { rows: [eventRow] }
      if (text.includes('count(*)')) return { rows: [{ count: '0' }] }
      return { rows: [] }
    })
    await expect(eventPaymentRepository.prepareCheckoutOrder({ profileId, eventId, provider: 'razorpay', now }))
      .rejects.toMatchObject({ code: 'checkout_in_progress' })
  })
})

describe('event payment repository: confirming payment', () => {
  const client = { query: db.txQuery }

  it('marks the order paid and confirms the seat, linking the attendee row to the order', async () => {
    scenario({ lockedOrder: orderRow(), attendees: 1 })
    const outcome = await eventPaymentRepository.confirmPaidOrder(client, { orderId, providerPaymentId: 'pay_1', now })
    expect(outcome.state).toBe('registered')
    const attendeeInsert = db.txQuery.mock.calls.find((call) => String(call[0]).includes('insert into public.event_attendees'))
    expect(attendeeInsert?.[1]).toEqual([eventId, profileId, orderId])
    expect(String(attendeeInsert?.[0])).toContain('on conflict (event_id, user_id) do nothing')
  })

  it('is idempotent: an order that is already paid is not changed again', async () => {
    scenario({ lockedOrder: orderRow({ status: 'paid', provider_payment_id: 'pay_1', registration_confirmed_at: now.toISOString() }) })
    await expect(eventPaymentRepository.confirmPaidOrder(client, { orderId, providerPaymentId: 'pay_1', now }))
      .resolves.toMatchObject({ state: 'registered' })
    expect(sqlCalls().filter((sql) => /^\s*(update|insert)\b/.test(sql))).toEqual([])

    db.txQuery.mockClear()
    scenario({ lockedOrder: orderRow({ status: 'refunded' }) })
    await expect(eventPaymentRepository.confirmPaidOrder(client, { orderId, providerPaymentId: 'pay_1', now }))
      .resolves.toMatchObject({ state: 'refunded' })
    expect(sqlCalls().filter((sql) => /^\s*(update|insert)\b/.test(sql))).toEqual([])
  })

  it('keeps the money on record but flags a refund when the event filled up meanwhile', async () => {
    scenario({ lockedOrder: orderRow(), attendees: 2 })
    const outcome = await eventPaymentRepository.confirmPaidOrder(client, { orderId, providerPaymentId: 'pay_1', now })
    expect(outcome).toMatchObject({ state: 'refund_due', reason: 'event_full' })
    expect(sqlCalls().some((sql) => sql.includes('insert into public.event_attendees'))).toBe(false)
    expect(sqlCalls().some((sql) => sql.includes("set status = 'paid'"))).toBe(true)
  })

  it('flags a refund when registration closed before the payment arrived', async () => {
    scenario({ lockedOrder: orderRow(), event: { ...eventRow, registration_closes_at: '2030-01-01T09:59:00.000Z' } })
    await expect(eventPaymentRepository.confirmPaidOrder(client, { orderId, providerPaymentId: 'pay_1', now }))
      .resolves.toMatchObject({ state: 'refund_due', reason: 'event_registration_closed' })
  })

  it('flags a refund when the reported amount differs from the order', async () => {
    scenario({ lockedOrder: orderRow() })
    await expect(eventPaymentRepository.confirmPaidOrder(client, { orderId, providerPaymentId: 'pay_1', amountMinor: 100, currency: 'INR', now }))
      .resolves.toMatchObject({ state: 'refund_due', reason: 'amount_mismatch' })
  })

  it('releases the seat when a payment is refunded', async () => {
    db.txQuery.mockResolvedValue({ rows: [orderRow({ status: 'refunded' })] })
    await eventPaymentRepository.markOrderRefunded(client, orderId)
    expect(sqlCalls().some((sql) => sql.includes('delete from public.event_attendees where payment_order_id = $1::uuid'))).toBe(true)
  })
})

describe('event payment repository: webhooks and organiser view', () => {
  it('reports whether a webhook delivery is new', async () => {
    const client = { query: db.txQuery }
    db.txQuery.mockResolvedValueOnce({ rows: [{ provider_event_id: 'evt_1' }] }).mockResolvedValueOnce({ rows: [] })
    await expect(eventPaymentRepository.recordWebhookEvent(client, 'razorpay', 'evt_1', 'payment.captured')).resolves.toBe(true)
    await expect(eventPaymentRepository.recordWebhookEvent(client, 'razorpay', 'evt_1', 'payment.captured')).resolves.toBe(false)
    expect(String(db.txQuery.mock.calls[0]?.[0])).toContain('on conflict (provider, provider_event_id) do nothing')
  })

  it('lists payments only for the host or organisation event managers', async () => {
    db.query.mockResolvedValue([{ ...orderRow({ status: 'paid' }), attendee_name: 'Capt. Rao', attendee_slug: 'capt-rao', paid_at: now.toISOString(), refunded_at: null }])
    const rows = await eventPaymentRepository.listEventPaymentsForManager(profileId, eventId)
    expect(rows[0]).toMatchObject({ attendeeName: 'Capt. Rao', amountMinor: 49900, status: 'paid' })
    const sql = String(db.query.mock.calls[0]?.[0])
    expect(sql).toContain('e.host_user_id = $1::uuid')
    expect(sql).toContain("'event_manager'")
    expect(db.query.mock.calls[0]?.[1]).toEqual([profileId, eventId])
  })
})
