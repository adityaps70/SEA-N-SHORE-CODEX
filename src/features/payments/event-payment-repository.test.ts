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
  earning?: Record<string, unknown> | null
  refundRequestStale?: boolean
}

function earningRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    seller_profile_id: eventRow.host_user_id,
    seller_company_id: null,
    source_type: 'event_ticket',
    source_id: orderId,
    adjusts_earning_id: null,
    currency: 'INR',
    gross_minor: '49900',
    platform_fee_percent: '10.00',
    platform_fee_minor: '4990',
    net_minor: '44910',
    status: 'pending',
    available_at: '2030-01-12T10:00:00.000Z',
    payout_id: null,
    reversed_reason: null,
    created_at: now.toISOString(),
    ...overrides,
  }
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
    if (text.includes('from public.platform_fee_settings')) return { rows: [{ default_percent: '10.00', hold_days: 7 }] }
    if (text.includes('insert into public.seller_earnings')) {
      return { rows: [earningRow({ seller_profile_id: values[0], seller_company_id: values[1], gross_minor: values[5], platform_fee_minor: values[7], net_minor: values[8], available_at: values[9] })] }
    }
    if (text.includes('from public.seller_earnings where source_type = $1::text and source_id = $2::text for update')) return { rows: input.earning ? [input.earning] : [] }
    if (text.includes("set status = 'reversed'")) return { rows: [{ ...input.earning, status: 'reversed' }] }
    if (text.includes('refund_requested_at < now()')) return { rows: [{ stale: Boolean(input.refundRequestStale) }] }
    if (text.includes("set refund_status = 'requested'")) return { rows: [orderRow({ ...input.lockedOrder, refund_status: 'requested', refund_attempts: Number(input.lockedOrder?.refund_attempts ?? 0) + 1 })] }
    if (text.includes("set status = 'refunded'")) return { rows: [orderRow({ ...input.lockedOrder, status: 'refunded', refund_status: values[1] ?? 'processed', provider_refund_id: values[2] })] }
    if (text.includes('insert into public.event_payment_orders')) {
      return { rows: [orderRow({ provider_order_id: null, amount_minor: values[3], currency: values[4], created_at: now.toISOString() })] }
    }
    if (text.includes('set refund_due_reason')) return { rows: [orderRow({ status: 'paid', provider_payment_id: 'pay_1', refund_due_reason: values[1] })] }
    if (text.includes('set registration_confirmed_at')) return { rows: [orderRow({ status: 'paid', provider_payment_id: 'pay_1', registration_confirmed_at: now.toISOString() })] }
    return { rows: [] }
  })
}

function auditActions() {
  return db.txQuery.mock.calls
    .filter((call) => String(call[0]).includes('insert into public.payment_audit_events'))
    .map((call) => (call[1] as unknown[])[4])
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

  it('releases the seat, reverses the organiser earning and audits a refund', async () => {
    scenario({
      lockedOrder: orderRow({ status: 'paid', provider_payment_id: 'pay_1', registration_confirmed_at: now.toISOString(), refund_status: 'requested' }),
      earning: earningRow(),
    })
    const order = await eventPaymentRepository.markOrderRefunded(client, orderId, { providerRefundId: 'rfnd_1', refundStatus: 'processed', actor: { type: 'organizer', profileId: eventRow.host_user_id } })
    expect(order).toMatchObject({ status: 'refunded', refundStatus: 'processed', providerRefundId: 'rfnd_1' })
    expect(sqlCalls().some((sql) => sql.includes('delete from public.event_attendees where payment_order_id = $1::uuid'))).toBe(true)
    expect(sqlCalls().some((sql) => sql.includes("set status = 'reversed'"))).toBe(true)
    expect(auditActions()).toEqual(['refunded', 'earning_reversed'])
  })

  it('does not refund an order that was never paid', async () => {
    scenario({ lockedOrder: orderRow({ status: 'created' }) })
    await expect(eventPaymentRepository.markOrderRefunded(client, orderId)).resolves.toBeNull()
    expect(sqlCalls().some((sql) => sql.includes('delete from public.event_attendees'))).toBe(false)
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

describe('event payment repository: seller earnings, refunds and Cashfree lookups', () => {
  const client = { query: db.txQuery }

  it('records the organisation earning when a seat is confirmed, available a hold period after the event ends', async () => {
    const companyId = '55555555-5555-4555-8555-555555555555'
    scenario({ lockedOrder: orderRow(), event: { ...eventRow, company_id: companyId } })
    await expect(eventPaymentRepository.confirmPaidOrder(client, { orderId, providerPaymentId: 'pay_1', now, actor: { type: 'provider' } }))
      .resolves.toMatchObject({ state: 'registered' })
    const insert = db.txQuery.mock.calls.find((call) => String(call[0]).includes('insert into public.seller_earnings'))!
    // seller = the hosting organization; available = event end (5 Jan) + 7 days.
    expect(insert[1]).toEqual([null, companyId, 'event_ticket', orderId, 'INR', 49900, '10.00', 4990, 44910, '2030-01-12T10:00:00.000Z'])
    expect(auditActions()).toEqual(['paid', 'seat_confirmed', 'earning_recorded'])
  })

  it('records the host profile as seller for a personal event', async () => {
    scenario({ lockedOrder: orderRow() })
    await eventPaymentRepository.confirmPaidOrder(client, { orderId, providerPaymentId: 'pay_1', now })
    const insert = db.txQuery.mock.calls.find((call) => String(call[0]).includes('insert into public.seller_earnings'))!
    expect((insert[1] as unknown[]).slice(0, 2)).toEqual([eventRow.host_user_id, null])
  })

  it('records no earning for a payment that is due a refund', async () => {
    scenario({ lockedOrder: orderRow(), attendees: 2 })
    await eventPaymentRepository.confirmPaidOrder(client, { orderId, providerPaymentId: 'pay_1', now })
    expect(sqlCalls().some((sql) => sql.includes('insert into public.seller_earnings'))).toBe(false)
    expect(auditActions()).toEqual(['paid', 'refund_due'])
  })

  it('marks a refund as requested once, so a double click cannot refund twice', async () => {
    scenario({ lockedOrder: orderRow({ status: 'paid', provider_payment_id: 'pay_1' }) })
    await expect(eventPaymentRepository.requestRefund(client, { orderId, actor: { type: 'organizer', profileId }, reason: 'organizer_refund' }))
      .resolves.toMatchObject({ attempt: 1, order: { refundStatus: 'requested' } })
    expect(auditActions()).toEqual(['refund_requested'])

    scenario({ lockedOrder: orderRow({ status: 'paid', provider_payment_id: 'pay_1', refund_status: 'requested', refund_attempts: 1 }) })
    await expect(eventPaymentRepository.requestRefund(client, { orderId, actor: { type: 'organizer', profileId }, reason: 'organizer_refund' }))
      .rejects.toMatchObject({ code: 'refund_in_progress' })

    scenario({ lockedOrder: orderRow({ status: 'created' }) })
    await expect(eventPaymentRepository.requestRefund(client, { orderId, actor: { type: 'admin', profileId }, reason: 'admin_refund' }))
      .rejects.toMatchObject({ code: 'refund_not_allowed' })
  })

  it('allows a retry after a failed refund', async () => {
    scenario({ lockedOrder: orderRow({ status: 'refunded', provider_payment_id: 'pay_1', refund_status: 'failed', refund_attempts: 1 }) })
    await expect(eventPaymentRepository.requestRefund(client, { orderId, actor: { type: 'admin', profileId }, reason: 'admin_refund' }))
      .resolves.toMatchObject({ attempt: 2 })
  })

  it('refuses a currency the gateway cannot charge', async () => {
    scenario({ event: { ...eventRow, currency: 'USD', price_minor: '2500' } })
    await expect(eventPaymentRepository.prepareCheckoutOrder({ profileId, eventId, provider: 'cashfree', currencies: ['INR'], now }))
      .rejects.toMatchObject({ code: 'event_currency_unsupported' })
  })

  it('does not reuse an open checkout from another gateway', async () => {
    scenario({ openOrder: orderRow({ provider: 'razorpay' }) })
    const result = await eventPaymentRepository.prepareCheckoutOrder({ profileId, eventId, provider: 'cashfree', now })
    expect(result.reused).toBe(false)
  })

  it('finds a Cashfree order by our id even before its gateway id was saved', async () => {
    db.txQuery.mockImplementation(async (sql: string) => {
      const text = String(sql).replace(/\s+/g, ' ')
      if (text.includes('o.provider_order_id = $2::text limit 1')) return { rows: [] }
      if (text.includes('where o.id = $1::uuid and o.provider = $2::text')) return { rows: [orderRow({ provider: 'cashfree', provider_order_id: null })] }
      return { rows: [] }
    })
    await expect(eventPaymentRepository.findOrderByProviderOrderId(client, 'cashfree', 'evt_33333333333343338333333333333333'))
      .resolves.toMatchObject({ id: orderId })
    const byId = db.txQuery.mock.calls.find((call) => String(call[0]).includes('where o.id = $1::uuid and o.provider'))
    expect(byId?.[1]).toEqual([orderId, 'cashfree', 'evt_33333333333343338333333333333333'])
  })
})
