import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))

import type { DatabaseQueryClient } from '@/lib/db/client'
import { getPaymentsOverview, listRecentPayments, listSellerEarnings, searchSellers } from './payout-queries'

function fakeClient(tables: Record<string, string[]>, rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('information_schema.columns')) return { rows: (tables[String(values[0])] ?? []).map((column_name) => ({ column_name })) }
    return { rows }
  })
  return { client: { query } as unknown as DatabaseQueryClient, query }
}

describe('recent payments across events, courses and plans', () => {
  it('lists event payments and reports course/plan tables that do not exist yet', async () => {
    const { client, query } = fakeClient({}, [{ type: 'event', id: 'o1', occurred_at: '2026-09-20T10:00:00.000Z', amount_minor: '49900', currency: 'INR', status: 'paid', provider: 'cashfree', reference: 'cf_1', title: 'Tanker Safety Workshop', payer_name: 'Arjun Rao', payer_slug: 'arjun' }])
    const result = await listRecentPayments(client, { type: 'all', status: 'all' })
    expect(result.unavailable).toEqual(['course', 'plan'])
    expect(result.lines).toEqual([expect.objectContaining({ type: 'event', amountMinor: 49900, status: 'paid', title: 'Tanker Safety Workshop' })])
    const sql = String(query.mock.calls.at(-1)![0])
    expect(sql).toContain('from public.event_payment_orders o')
    expect(sql).not.toContain('course_payment_orders')
    expect(query.mock.calls.at(-1)![1]).toEqual(['all', 'all'])
  })

  it('reads the course and plan tables by the columns they actually have', async () => {
    const { client, query } = fakeClient({
      course_payment_orders: ['id', 'course_id', 'profile_id', 'amount_minor', 'currency', 'status', 'provider', 'provider_order_id', 'paid_at', 'created_at'],
      subscription_payments: ['id', 'amount_minor', 'currency', 'status', 'provider_payment_id', 'plan_code', 'company_id', 'profile_id', 'created_at'],
    })
    const result = await listRecentPayments(client, { type: 'course', status: 'refunded' })
    expect(result.unavailable).toEqual([])
    const sql = String(query.mock.calls.at(-1)![0])
    expect(sql).toContain('from public.course_payment_orders t')
    expect(sql).toContain('left join public.courses c on c.id = t.course_id')
    expect(sql).toContain('t.amount_minor::bigint')
    expect(sql).toContain('from public.subscription_payments t')
    expect(sql).toContain("when 'creator_pro' then 'Creator Pro'")
    expect(query.mock.calls.at(-1)![1]).toEqual(['course', 'refunded'])
  })

  it('skips a table that lacks an amount column instead of failing', async () => {
    const { client } = fakeClient({ course_payment_orders: ['id', 'status', 'created_at'] })
    expect((await getPaymentsOverview(client)).unavailable).toEqual(['course', 'plan'])
  })
})

describe('seller earnings lines', () => {
  it('labels course sales from the course orders table when available', async () => {
    const earningRow = { id: 'e1', source_type: 'course_purchase', base_source_type: 'course_purchase', base_source_id: '33333333-3333-4333-8333-333333333333', event_title: null, sold_at: '2026-09-20T10:00:00.000Z', currency: 'INR', gross_minor: '19960', platform_fee_percent: '10.00', platform_fee_minor: '1996', net_minor: '17964', status: 'available', available_at: '2026-09-27T10:00:00.000Z', payout_id: null, reversed_reason: null }
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes('information_schema.columns')) return { rows: values[0] === 'course_payment_orders' ? [{ column_name: 'id' }, { column_name: 'course_id' }] : [] }
      if (sql.includes('from public.course_payment_orders o')) return { rows: [{ id: '33333333-3333-4333-8333-333333333333', title: 'ECDIS Refresher' }] }
      return { rows: [earningRow] }
    })
    const { lines } = await listSellerEarnings({ query } as unknown as DatabaseQueryClient, { profileId: '44444444-4444-4444-8444-444444444444' })
    expect(lines[0]).toMatchObject({ title: 'ECDIS Refresher', grossMinor: 19960, feeMinor: 1996, netMinor: 17964, feePercent: '10.00' })
  })
})

describe('seller search', () => {
  it('escapes LIKE wildcards and needs at least 2 characters', async () => {
    const { client, query } = fakeClient({})
    expect(await searchSellers(client, 'a')).toEqual([])
    expect(query).not.toHaveBeenCalled()
    await searchSellers(client, '50%_off')
    expect(query.mock.calls[0]![1]).toEqual(['%50\\%\\_off%'])
  })
})
