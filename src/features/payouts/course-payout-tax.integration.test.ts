import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'

/**
 * C4 against the real schema (PGlite), through the real payout code: a month's course earnings are paid only once the
 * seller's invoice for it is approved; a course payout needs the TDS rate and the seller's PAN; TDS is deducted so the
 * Cashfree transfer (amount_minor) = gross − TDS; event earnings and course refunds are paid as before.
 */

let db: TestDatabase

vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const repository = await import('./payout-repository')
const queries = await import('./payout-queries')
const tax = await import('./payout-tax')
const invoices = await import('./seller-invoices')
const report = await import('./tds-report')
const settings = await import('@/features/tax/tax-settings')
const { indiaMonth } = await import('@/features/tax/gst')

type Client = Parameters<typeof repository.createPayout>[0]

function pgClient(query: (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>): Client {
  return { async query(text: string, values?: readonly unknown[]) { return { rows: await query(text, values) } } } as unknown as Client
}

function inTransaction<T>(work: (tx: Client) => Promise<T>) {
  return db.transaction((query) => work(pgClient(query)))
}

function refusal(promise: Promise<unknown>) {
  return promise.then(() => 'ok', (error: unknown) => (error instanceof repository.PayoutError || error instanceof invoices.SellerInvoiceError ? error.code : String(error)))
}

const NOW = new Date('2026-10-10T06:00:00.000Z')
let admin: string

beforeAll(async () => {
  db = await createTestDatabase()
  admin = await profile('Fixture Admin')
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function profile(name: string) {
  const rows = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), $1) returning id`, [name])
  return rows[0]!.id as string
}

async function sellerWithAccount(name: string) {
  const id = await profile(name)
  await db.query(`
    insert into public.payout_accounts (seller_profile_id, method, account_holder_name, bank_ifsc, bank_account_last4, provider_beneficiary_id, provider_status, provider_verified, status)
    values ($1, 'bank', 'Fixture Seller', 'HDFC0000001', '1772', $2, 'VERIFIED', true, 'active')
  `, [id, `snsb_${id.replaceAll('-', '').slice(0, 20)}`])
  return id
}

/** A sale earning (10% fee) for a seller, created at `at` (its month decides the invoice). */
async function earning(seller: string, input: { type: 'event_ticket' | 'course_purchase'; netMinor: number; at: string; status?: string }) {
  const gross = Math.round(input.netMinor / 0.9)
  const fee = gross - input.netMinor
  const rows = await db.query(`
    insert into public.seller_earnings (seller_profile_id, source_type, source_id, currency, gross_minor, platform_fee_percent, platform_fee_minor, net_minor, status, available_at, created_at)
    values ($1, $2, $3, 'INR', $4, 10, $5, $6, $7, $8, $8) returning id
  `, [seller, input.type, randomUUID(), gross, fee, input.netMinor, input.status ?? 'available', input.at])
  return rows[0]!.id as string
}

/** The refund adjustment of an earning that was already paid out (negative, always available). */
async function adjustment(seller: string, of: string, at: string) {
  const [original] = await db.query(`select gross_minor::int as gross, platform_fee_minor::int as fee, net_minor::int as net from public.seller_earnings where id = $1`, [of])
  const rows = await db.query(`
    insert into public.seller_earnings (seller_profile_id, source_type, source_id, adjusts_earning_id, currency, gross_minor, platform_fee_percent, platform_fee_minor, net_minor, status, available_at, created_at)
    values ($1, 'adjustment', $2::text, $3::uuid, 'INR', $4, 10, $5, $6, 'available', $7, $7) returning id
  `, [seller, of, of, -original!.gross, -original!.fee, -original!.net, at])
  return rows[0]!.id as string
}

async function payable(seller: string) {
  return queries.listPayableEarningLines(db.client as unknown as Client, { profileId: seller })
}

async function send(seller: string, options: { expectedTdsMinor?: number } = {}) {
  const lines = await payable(seller)
  const result = await inTransaction((tx) => repository.createPayout(tx, {
    payoutId: randomUUID(),
    seller: { profileId: seller },
    earningIds: lines.map((line) => line.id),
    expectedTotalMinor: lines.reduce((sum, line) => sum + line.netMinor, 0),
    ...options,
    minPayoutMinor: 10_000,
    actorProfileId: admin,
    now: NOW,
  }))
  // The payout row is stamped by the database clock; pin it to the test's "now" so the financial year and month are fixed.
  await db.query(`update public.payouts set created_at = $2 where id = $1`, [result.payout.id, NOW.toISOString()])
  return result
}

async function complete(payoutId: string, amountMinor: number) {
  return inTransaction((tx) => repository.applyTransferReport(tx, { payoutId, report: { status: 'SUCCESS', utr: `UTR${payoutId.slice(0, 6)}`, amountMinor }, actor: { type: 'provider' }, source: 'webhook' }))
}

async function invoice(seller: string, period: string, amountMinor: number) {
  return inTransaction((tx) => invoices.createSellerInvoice(tx, {
    seller: { profileId: seller },
    period,
    documentNumber: `INV-${period}`,
    amountMinor,
    storagePath: `seller-invoices/profile-${seller}/${period}/${randomUUID()}.pdf`,
    fileName: `invoice-${period}.pdf`,
    contentType: 'application/pdf',
    sizeBytes: 2048,
    actorProfileId: seller,
    now: NOW,
  }))
}

async function review(invoiceId: string, decision: 'approve' | 'reject', note: string | null = null) {
  return inTransaction((tx) => invoices.reviewSellerInvoice(tx, { invoiceId, decision, note, actorProfileId: admin }))
}

async function setTds(rateBasisPoints: number | null, thresholdMinor: number | null) {
  await inTransaction((tx) => settings.updateTdsSettings(tx, { section: '194J', rateBasisPoints, thresholdMinor, actorProfileId: admin }))
}

async function saveTaxDetails(seller: string, gstRegistered = false) {
  await inTransaction((tx) => tax.savePayoutTaxProfile(tx, {
    seller: { profileId: seller },
    legalName: 'Fixture Seller',
    pan: gstRegistered ? 'AASFB2030K' : 'ABCDE1234F',
    gstRegistered,
    gstin: gstRegistered ? '27AASFB2030K1ZE' : null,
    actorProfileId: seller,
  }))
}

describe('course earnings wait for an approved seller invoice; event earnings and refunds do not (C4)', () => {
  it('gates course earnings by month, pays events and course refunds as before, then deducts TDS once invoiced', async () => {
    await setTds(null, null)
    const seller = await sellerWithAccount('Fixture Seller A')
    const event = await earning(seller, { type: 'event_ticket', netMinor: 44_910, at: '2026-09-05T10:00:00.000Z' })
    const august = await earning(seller, { type: 'course_purchase', netMinor: 180_000, at: '2026-08-15T10:00:00.000Z' })
    // A July course sale already paid out, refunded in September: its negative adjustment is always payable.
    const july = await earning(seller, { type: 'course_purchase', netMinor: 18_000, at: '2026-07-10T10:00:00.000Z', status: 'paid' })
    const refund = await adjustment(seller, july, '2026-09-20T10:00:00.000Z')

    // The August course sale is held back; the event sale and the course refund are payable.
    expect((await payable(seller)).map((line) => line.id).sort()).toEqual([event, refund].sort())
    const queue = (await queries.listPayoutQueue(db.client as unknown as Client)).find((line) => line.sellerIdentity.seller.profileId === seller)!
    expect(queue).toMatchObject({ availableMinor: 26_910, courseMinor: -18_000, awaitingInvoiceMinor: 180_000, awaitingPeriods: ['2026-08'], hasTaxProfile: false })

    // Asking to pay the August sale anyway is refused with the month.
    const forced = inTransaction((tx) => repository.createPayout(tx, {
      payoutId: randomUUID(), seller: { profileId: seller }, earningIds: [event, refund, august], expectedTotalMinor: 206_910, minPayoutMinor: 10_000, actorProfileId: admin, now: NOW,
    }))
    await expect(forced).rejects.toMatchObject({ code: 'invoice_missing', periods: ['2026-08'] })

    // Events plus the course refund: no TDS (no positive course part), so neither the PAN nor the rate is needed.
    const first = await send(seller)
    expect(first.kind).toBe('created')
    expect(first.payout).toMatchObject({ amountMinor: 26_910, grossMinor: 26_910, tdsMinor: 0, tdsBaseMinor: 0, tdsSection: null, tdsFinancialYear: null })
    await complete(first.payout.id, 26_910)
    expect(await db.query(`select status from public.seller_earnings where id = any($1::uuid[]) order by status`, [[event, refund]])).toEqual([{ status: 'paid' }, { status: 'paid' }])

    // The statement: August needs an invoice for exactly ₹1,800; September only has the refund (nothing to invoice).
    const months = await invoices.listSellerInvoiceMonths(db.client as unknown as Client, { profileId: seller }, NOW)
    expect(months.find((month) => month.period === '2026-08')).toMatchObject({ expectedMinor: 180_000, state: 'due', invoice: null })
    expect(months.find((month) => month.period === '2026-09')).toMatchObject({ expectedMinor: -18_000, state: 'not_needed' })

    // Without tax details the seller cannot invoice; with them, a wrong amount is refused with the exact amount.
    expect(await refusal(invoice(seller, '2026-08', 180_000))).toBe('tax_details_missing')
    await saveTaxDetails(seller)
    await expect(invoice(seller, '2026-08', 179_999)).rejects.toMatchObject({ code: 'amount_mismatch', expectedMinor: 180_000 })
    const submitted = await invoice(seller, '2026-08', 180_000)
    expect(submitted).toMatchObject({ kind: 'bill_of_supply', status: 'submitted', expectedAmountMinor: 180_000 })
    expect(await refusal(invoice(seller, '2026-08', 180_000))).toBe('already_submitted')

    // Submitted is not enough: the August sale stays out until an administrator approves.
    expect((await payable(seller)).map((line) => line.id)).toEqual([])
    await review(submitted.id, 'approve')
    expect((await payable(seller)).map((line) => line.id)).toEqual([august])
    expect(await refusal(invoice(seller, '2026-08', 180_000))).toBe('already_approved')

    // Course payout: refused while the TDS rate is not set.
    expect(await refusal(send(seller))).toBe('tds_rate_unset')
    await setTds(1000, null)
    // The admin's review showed a different TDS: refused rather than sending another amount.
    expect(await refusal(send(seller, { expectedTdsMinor: 0 }))).toBe('balance_changed')

    // No threshold = TDS from the first rupee. The year's course total is ₹1,800 − ₹180 (the refund paid earlier) = ₹1,620,
    // so TDS is 10% of it, ₹162, all taken from this payout.
    const second = await send(seller, { expectedTdsMinor: 16_200 })
    expect(second.payout).toMatchObject({ grossMinor: 180_000, tdsBaseMinor: 180_000, tdsMinor: 16_200, amountMinor: 163_800, tdsSection: '194J', tdsRateBasisPoints: 1000, tdsFinancialYear: '2026-27' })
    const [row] = await db.query(`select amount_minor::int, gross_minor::int, tds_minor::int, seller_pan from public.payouts where id = $1`, [second.payout.id])
    expect(row).toEqual({ amount_minor: 163_800, gross_minor: 180_000, tds_minor: 16_200, seller_pan: 'ABCDE1234F' })

    // Cashfree is checked against the transfer (net), not the gross.
    expect(await inTransaction((tx) => repository.applyTransferReport(tx, { payoutId: second.payout.id, report: { status: 'SUCCESS', amountMinor: 180_000 }, actor: { type: 'provider' }, source: 'webhook' })))
      .toMatchObject({ changed: false, reason: 'amount_mismatch' })
    expect(await complete(second.payout.id, 163_800)).toMatchObject({ changed: true, payout: { status: 'success' } })

    // The monthly TDS report lists the course payout (not the event-only one) with the PAN stored on it.
    const rows = await report.listTdsReportRows(db.client as unknown as Client, indiaMonth(NOW))
    expect(rows.filter((line) => line.payoutId === second.payout.id)).toEqual([expect.objectContaining({ pan: 'ABCDE1234F', section: '194J', rateBasisPoints: 1000, tdsBaseMinor: 180_000, tdsMinor: 16_200, grossMinor: 180_000, netMinor: 163_800, status: 'success', financialYear: '2026-27', sellerName: 'Fixture Seller', sellerType: 'Individual' })])
    expect(rows.some((line) => line.payoutId === first.payout.id)).toBe(false)
    const csv = report.tdsReportToCsv(rows)
    expect(csv.startsWith('﻿Payout date,Payout ID,Transfer ID,Seller name,Seller type,PAN,Section,Rate %,Course amount (TDS base),TDS deducted,Gross paid,Net transferred,Status,Financial year\r\n')).toBe(true)
    expect(csv).toContain(',ABCDE1234F,194J,10,1800.00,162.00,1800.00,1638.00,Paid,2026-27')

    // The PAN never reaches the audit trail.
    const audits = await db.query(`select details::text as details from public.payment_audit_events where subject_type in ('payout_tax_profile', 'payout', 'seller_invoice')`)
    expect(audits.length).toBeGreaterThan(0)
    expect(audits.map((audit) => audit.details).join(' ')).not.toContain('ABCDE1234F')
  }, 120_000)

  it('refuses a course payout without the seller’s PAN, and catches TDS up once the threshold is crossed', async () => {
    await setTds(1000, 100_000) // 10% once the year's course total passes ₹1,000
    const seller = await sellerWithAccount('Fixture Seller B')
    await earning(seller, { type: 'course_purchase', netMinor: 80_000, at: '2026-08-03T10:00:00.000Z' })
    const august = (await invoices.listSellerInvoiceMonths(db.client as unknown as Client, { profileId: seller }, NOW))[0]!
    expect(august).toMatchObject({ period: '2026-08', expectedMinor: 80_000, state: 'due' })

    // Approved invoice, rate set, but no PAN on file: refused. (Tax details are needed to invoice, so remove them after.)
    await saveTaxDetails(seller, true)
    const augustInvoice = await invoice(seller, '2026-08', 80_000)
    expect(augustInvoice.kind).toBe('tax_invoice')
    await review(augustInvoice.id, 'approve')
    await db.query(`delete from public.payout_tax_profiles where seller_profile_id = $1`, [seller])
    expect(await refusal(send(seller))).toBe('pan_missing')
    await saveTaxDetails(seller, true)

    // ₹800: the year is still under ₹1,000, so no TDS, but the PAN, section and rate are recorded.
    const first = await send(seller)
    expect(first.payout).toMatchObject({ grossMinor: 80_000, tdsBaseMinor: 80_000, tdsMinor: 0, amountMinor: 80_000, tdsFinancialYear: '2026-27' })
    await complete(first.payout.id, 80_000)

    // September ₹500 more: the year is ₹1,300 > ₹1,000, so TDS is caught up on the whole year: 10% × ₹1,300 = ₹130.
    await earning(seller, { type: 'course_purchase', netMinor: 50_000, at: '2026-09-03T10:00:00.000Z' })
    const september = await invoice(seller, '2026-09', 50_000)
    await review(september.id, 'approve')
    const second = await send(seller)
    expect(second.payout).toMatchObject({ grossMinor: 50_000, tdsBaseMinor: 50_000, tdsMinor: 13_000, amountMinor: 37_000 })
  }, 120_000)

  it('lets an administrator reject an invoice so the seller can replace it, and refuses to approve one whose month changed', async () => {
    await setTds(1000, null)
    const seller = await sellerWithAccount('Fixture Seller C')
    await saveTaxDetails(seller)
    const sale = await earning(seller, { type: 'course_purchase', netMinor: 90_000, at: '2026-09-12T10:00:00.000Z' })
    await earning(seller, { type: 'course_purchase', netMinor: 45_000, at: '2026-09-25T10:00:00.000Z' })

    // The month in progress cannot be invoiced yet.
    await earning(seller, { type: 'course_purchase', netMinor: 10_000, at: '2026-10-02T10:00:00.000Z' })
    expect(await refusal(invoice(seller, '2026-10', 10_000))).toBe('period_open')

    const first = await invoice(seller, '2026-09', 135_000)
    const rejected = await review(first.id, 'reject', 'The bill is not signed.')
    expect(rejected).toMatchObject({ status: 'rejected', reviewNote: 'The bill is not signed.' })
    expect(await refusal(review(first.id, 'approve'))).toBe('not_submitted')
    let months = await invoices.listSellerInvoiceMonths(db.client as unknown as Client, { profileId: seller }, NOW)
    expect(months.find((month) => month.period === '2026-09')).toMatchObject({ state: 'rejected', invoice: { status: 'rejected', reviewNote: 'The bill is not signed.' } })

    // A replacement is accepted; then a September sale is refunded before review, so the invoice no longer matches.
    const replacement = await invoice(seller, '2026-09', 135_000)
    await db.query(`update public.seller_earnings set status = 'reversed', reversed_at = now(), reversed_reason = 'Refunded' where id = $1`, [sale])
    await expect(review(replacement.id, 'approve')).rejects.toMatchObject({ code: 'amount_changed', expectedMinor: 45_000 })
    const waiting = await invoices.listSellerInvoicesForReview(db.client as unknown as Client, { status: 'submitted' })
    expect(waiting.find((line) => line.id === replacement.id)).toMatchObject({ amountMinor: 135_000, currentExpectedMinor: 45_000, sellerName: 'Fixture Seller C', gstRegistered: false })

    await review(replacement.id, 'reject', 'Please invoice the new amount after the refund.')
    const corrected = await invoice(seller, '2026-09', 45_000)
    await review(corrected.id, 'approve')
    months = await invoices.listSellerInvoiceMonths(db.client as unknown as Client, { profileId: seller }, NOW)
    expect(months.find((month) => month.period === '2026-09')).toMatchObject({ expectedMinor: 45_000, state: 'approved' })
    expect(months.find((month) => month.period === '2026-10')).toMatchObject({ expectedMinor: 10_000, state: 'open' })
    const audit = await db.query(`select action from public.payment_audit_events where subject_type = 'seller_invoice' and subject_id = any($1::text[]) order by id`, [[first.id, replacement.id, corrected.id]])
    expect(audit.map((entry) => entry.action)).toEqual([
      'seller_invoice_submitted', 'seller_invoice_rejected', 'seller_invoice_submitted', 'seller_invoice_rejected', 'seller_invoice_submitted', 'seller_invoice_approved',
    ])
  }, 120_000)
})
