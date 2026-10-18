import { describe, expect, it } from 'vitest'
import { createPaymentHistoryRepository, paymentDocuments, paymentHistoryRows, type PaymentHistoryEntry } from './payment-history'

const viewer = '11111111-1111-4111-8111-111111111111'
const paymentId = '22222222-2222-4222-8222-222222222222'

function entry(overrides: Partial<PaymentHistoryEntry> = {}): PaymentHistoryEntry {
  return {
    id: paymentId, kind: 'subscription', at: '2026-10-01T06:30:00.000Z', item: 'Creator Pro · monthly', amountMinor: 9900, currency: 'INR',
    status: 'paid', invoiceId: null, invoiceNumber: null, creditNoteId: null, creditNoteNumber: null, ...overrides,
  }
}

function recorder(responses: Array<Record<string, unknown>[]>) {
  const seen: Array<{ text: string; values?: readonly unknown[] }> = []
  let call = 0
  return {
    seen,
    query: async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      return responses[call++] ?? []
    },
  }
}

describe('payment history (Round H, H7)', () => {
  it('links course purchases and seat packs to their tax invoice and credit note', () => {
    expect(paymentDocuments(entry({ kind: 'course', invoiceId: 'inv-1', invoiceNumber: 'SNS/26-27/000001', creditNoteId: 'cn-1', creditNoteNumber: 'SNC/26-27/000001', status: 'refunded' }))).toEqual([
      { href: '/api/learn/invoices/inv-1', label: 'Tax invoice SNS/26-27/000001' },
      { href: '/api/learn/credit-notes/cn-1', label: 'Credit note SNC/26-27/000001' },
    ])
    expect(paymentDocuments(entry({ kind: 'seat_pack', invoiceId: 'inv-2' }))).toEqual([{ href: '/api/learn/invoices/inv-2', label: 'Tax invoice' }])
    expect(paymentDocuments(entry({ kind: 'course' }))).toEqual([])
  })

  it('offers a payment receipt for paid subscriptions and event tickets only', () => {
    expect(paymentDocuments(entry())).toEqual([{ href: `/api/billing/receipts/subscription/${paymentId}`, label: 'Payment receipt' }])
    expect(paymentDocuments(entry({ kind: 'event', status: 'refunded' }))).toEqual([{ href: `/api/billing/receipts/event/${paymentId}`, label: 'Payment receipt' }])
    expect(paymentDocuments(entry({ status: 'failed' }))).toEqual([])
    expect(paymentDocuments(entry({ status: 'scheduled' }))).toEqual([])
  })

  it('lists newest first with the shared money formatter and plain statuses', () => {
    const rows = paymentHistoryRows([
      entry({ id: 'a', at: '2026-09-01T06:30:00.000Z', amountMinor: 9950 }),
      entry({ id: 'b', kind: 'event', at: '2026-10-05T06:30:00.000Z', item: 'Event ticket · Placeholder Summit', amountMinor: 150000, status: 'refunded' }),
      entry({ id: 'c', at: '2026-08-01T06:30:00.000Z', status: 'failed' }),
    ])
    expect(rows.map((row) => [row.item, row.amount, row.status, row.tone])).toEqual([
      ['Event ticket · Placeholder Summit', '₹1,500', 'Refunded', 'neutral'],
      ['Creator Pro · monthly', '₹99.50', 'Paid', 'success'],
      ['Creator Pro · monthly', '₹99', 'Failed — not charged', 'failed'],
    ])
    expect(rows[0]!.date).toBe('5 Oct 2026')
  })

  it('reads a member\'s own payments only, without writing anything', async () => {
    const { seen, query } = recorder([
      [{ id: 's1', amount_minor: '9900', currency: 'INR', status: 'success', paid_at: '2026-10-01T06:30:00.000Z', plan_code: 'creator_pro', billing_interval: 'month' }],
      [{ id: 'o1', course_title: 'Ballast basics', plan_name: null, seat_company_id: null, amount_minor: '49900', currency: 'INR', status: 'paid', paid_at: '2026-09-01T06:30:00.000Z', invoice_id: 'inv-1', invoice_number: 'SNS/26-27/000001' }],
      [{ id: 'e1', event_title: 'Placeholder Summit', amount_minor: '150000', currency: 'INR', status: 'paid', paid_at: '2026-08-01T06:30:00.000Z' }],
    ])
    const entries = await createPaymentHistoryRepository({ query }).listForProfile(viewer)
    expect(entries.map((item) => [item.kind, item.item, item.invoiceId])).toEqual([
      ['subscription', 'Creator Pro · monthly', null],
      ['course', 'Course · Ballast basics', 'inv-1'],
      ['event', 'Event ticket · Placeholder Summit', null],
    ])
    expect(seen[0]!.text).toMatch(/payment\.profile_id = \$1 and payment\.company_id is null/)
    expect(seen[1]!.text).toMatch(/o\.profile_id = \$1 and o\.seat_company_id is null/)
    expect(seen[2]!.text).toMatch(/e\.profile_id = \$1/)
    for (const call of seen) {
      expect(call.text).not.toMatch(/\b(insert|update|delete)\b/i)
      expect(call.values?.[0]).toBe(viewer)
    }
  })

  it('reads an organization\'s subscription payments and seat packs', async () => {
    const { seen, query } = recorder([
      [],
      [{ id: 'o2', course_title: 'Tanker safety', seat_company_id: 'co1', seat_quantity: 10, amount_minor: '900000', currency: 'INR', status: 'paid', paid_at: '2026-09-01T06:30:00.000Z', invoice_id: 'inv-2', invoice_number: 'SNS/26-27/000002' }],
    ])
    const entries = await createPaymentHistoryRepository({ query }).listForCompany('co1')
    expect(entries).toMatchObject([{ kind: 'seat_pack', item: 'Seat pack · 10 seats · Tanker safety', invoiceId: 'inv-2' }])
    expect(seen[0]!.text).toMatch(/payment\.company_id = \$1/)
    expect(seen[1]!.text).toMatch(/o\.seat_company_id = \$1/)
  })

  it('returns a subscription receipt only for the payer or an owner or administrator of the organization', async () => {
    const { seen, query } = recorder([[{
      id: paymentId, amount_minor: '9900', currency: 'INR', status: 'success', paid_at: '2026-10-01T06:30:00.000Z', plan_code: 'creator_pro',
      billing_interval: 'year', cf_payment_id: 'cf_123', payer_name: 'PLACEHOLDER MEMBER', company_name: null,
    }]])
    const receipt = await createPaymentHistoryRepository({ query }).getSubscriptionReceipt(paymentId, viewer)
    expect(receipt).toMatchObject({ id: paymentId, reference: 'cf_123', item: 'Creator Pro · yearly', payerName: 'Placeholder Member', amountMinor: 9900 })
    expect(seen[0]!.values).toEqual([paymentId, viewer])
    expect(seen[0]!.text).toMatch(/payment\.company_id is null and payment\.profile_id = \$2::uuid/)
    expect(seen[0]!.text).toMatch(/role::text in \('owner', 'administrator'\)/)
    expect(seen[0]!.text).toMatch(/payment\.status = 'success'/)
    const none = recorder([[]])
    await expect(createPaymentHistoryRepository({ query: none.query }).getSubscriptionReceipt(paymentId, viewer)).resolves.toBeNull()
  })

  it('returns an event receipt only for the buyer of a paid ticket', async () => {
    const { seen, query } = recorder([[{ id: paymentId, event_title: 'Placeholder Summit', amount_minor: '150000', currency: 'INR', status: 'refunded', paid_at: '2026-10-01T06:30:00.000Z', provider_payment_id: 'pay_1', payer_name: 'Placeholder Member' }]])
    await expect(createPaymentHistoryRepository({ query }).getEventReceipt(paymentId, viewer)).resolves.toMatchObject({ refunded: true, reference: 'pay_1', item: 'Event ticket · Placeholder Summit' })
    expect(seen[0]!.text).toMatch(/e\.profile_id = \$2::uuid and e\.status in \('paid', 'refunded'\)/)
  })
})
