import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ query: db.query, withTransaction: vi.fn() }))

import type { DatabaseQueryClient } from '@/lib/db/client'
import {
  computePlatformFee,
  earningAvailableAt,
  getSellerBalance,
  percentToBasisPoints,
  RELEASE_AVAILABLE_EARNINGS_SQL,
  recordSaleEarning,
  releaseAvailableEarnings,
  reverseSaleEarning,
  setSellerFeeOverride,
  updatePlatformFeeSettings,
} from './earnings'

const orgId = '55555555-5555-4555-8555-555555555555'
const hostId = '44444444-4444-4444-8444-444444444444'
const orderId = '33333333-3333-4333-8333-333333333333'

function earningRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    seller_profile_id: null,
    seller_company_id: orgId,
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
    created_at: '2030-01-01T10:00:00.000Z',
    ...overrides,
  }
}

type Ledger = {
  defaultPercent?: string
  holdDays?: number
  override?: string | null
  inserted?: Record<string, unknown> | null
  existing?: Record<string, unknown> | null
  locked?: Record<string, unknown> | null
}

function fakeTx(ledger: Ledger) {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    const text = sql.replace(/\s+/g, ' ')
    if (text.includes('from public.platform_fee_settings')) return { rows: [{ default_percent: ledger.defaultPercent ?? '10.00', hold_days: ledger.holdDays ?? 7 }] }
    if (text.includes('select percent from public.seller_fee_overrides')) return { rows: ledger.override ? [{ percent: ledger.override }] : [] }
    if (text.includes('insert into public.seller_earnings')) {
      if (ledger.inserted === null) return { rows: [] }
      const adjustment = text.includes("'adjustment'")
      return {
        rows: [ledger.inserted ?? earningRow(adjustment
          ? { id: '77777777-7777-4777-8777-777777777777', source_type: 'adjustment', source_id: values[2], adjusts_earning_id: values[2], gross_minor: values[4], platform_fee_minor: values[6], net_minor: values[7], status: 'available' }
          : { gross_minor: values[5], platform_fee_percent: values[6], platform_fee_minor: values[7], net_minor: values[8], available_at: values[9] })],
      }
    }
    if (text.includes('for update')) return { rows: ledger.locked ? [ledger.locked] : [] }
    if (text.includes("set status = 'reversed'")) return { rows: [{ ...ledger.locked, status: 'reversed', reversed_reason: values[1] }] }
    if (text.includes('from public.seller_earnings where source_type')) return { rows: ledger.existing ? [ledger.existing] : [] }
    return { rows: [] }
  })
  return { query } as unknown as DatabaseQueryClient & { query: typeof query }
}

function audits(tx: ReturnType<typeof fakeTx>) {
  return tx.query.mock.calls
    .filter((call) => String(call[0]).includes('insert into public.payment_audit_events'))
    .map((call) => ({ action: (call[1] as unknown[])[4], amount: (call[1] as unknown[])[7] }))
}

beforeEach(() => db.query.mockReset())

describe('platform fee math', () => {
  it('rounds the fee half-up to the paisa and nets the rest', () => {
    expect(computePlatformFee(49900, '10.00')).toEqual({ feeMinor: 4990, netMinor: 44910, percent: '10.00' })
    expect(computePlatformFee(5, '10')).toEqual({ feeMinor: 1, netMinor: 4, percent: '10.00' }) // 0.5 paise rounds up
    expect(computePlatformFee(4, '10')).toEqual({ feeMinor: 0, netMinor: 4, percent: '10.00' }) // 0.4 paise rounds down
    expect(computePlatformFee(33333, '12.5')).toEqual({ feeMinor: 4167, netMinor: 29166, percent: '12.50' }) // 4166.625
    expect(computePlatformFee(10001, '7.25')).toEqual({ feeMinor: 725, netMinor: 9276, percent: '7.25' }) // 725.0725
    expect(computePlatformFee(49900, 0)).toEqual({ feeMinor: 0, netMinor: 49900, percent: '0.00' })
    expect(computePlatformFee(49900, 100)).toEqual({ feeMinor: 49900, netMinor: 0, percent: '100.00' })
  })

  it('never loses a paisa: fee + net always equals gross', () => {
    for (const gross of [1, 99, 101, 12345, 99999, 100000000]) {
      for (const percent of ['0', '2.5', '9.99', '10', '33.33', '100']) {
        const { feeMinor, netMinor } = computePlatformFee(gross, percent)
        expect(feeMinor + netMinor).toBe(gross)
        expect(Number.isInteger(feeMinor)).toBe(true)
      }
    }
  })

  it('rejects impossible percents and amounts', () => {
    expect(() => percentToBasisPoints('100.01')).toThrow()
    expect(() => percentToBasisPoints('-1')).toThrow()
    expect(() => percentToBasisPoints('10.001')).toThrow()
    expect(() => computePlatformFee(0, '10')).toThrow()
    expect(() => computePlatformFee(10.5, '10')).toThrow()
  })

  it('adds the hold period to the moment the sale is final', () => {
    expect(earningAvailableAt(new Date('2030-01-05T10:00:00.000Z'), 7).toISOString()).toBe('2030-01-12T10:00:00.000Z')
  })
})

describe('recording and reversing sale earnings', () => {
  it('records the seller share with the default fee and the hold period, and audits it', async () => {
    const tx = fakeTx({})
    const result = await recordSaleEarning(tx, {
      sourceType: 'event_ticket',
      sourceId: orderId,
      seller: { companyId: orgId },
      grossMinor: 49900,
      currency: 'INR',
      availableAfter: new Date('2030-01-05T10:00:00.000Z'),
    })
    expect(result.created).toBe(true)
    expect(result.earning).toMatchObject({ seller: { companyId: orgId }, grossMinor: 49900, platformFeeMinor: 4990, netMinor: 44910, status: 'pending' })
    const insert = tx.query.mock.calls.find((call) => String(call[0]).includes('insert into public.seller_earnings'))!
    expect(insert[1]).toEqual([null, orgId, 'event_ticket', orderId, 'INR', 49900, '10.00', 4990, 44910, '2030-01-12T10:00:00.000Z'])
    expect(String(insert[0])).toContain('on conflict (source_type, source_id) do nothing')
    expect(audits(tx)).toEqual([{ action: 'earning_recorded', amount: 44910 }])
  })

  it('uses a seller override instead of the default', async () => {
    const tx = fakeTx({ override: '5.00' })
    const { earning } = await recordSaleEarning(tx, {
      sourceType: 'event_ticket', sourceId: orderId, seller: { profileId: hostId }, grossMinor: 49900, currency: 'INR', availableAfter: new Date(),
    })
    expect(earning.platformFeeMinor).toBe(2495)
    const insert = tx.query.mock.calls.find((call) => String(call[0]).includes('insert into public.seller_earnings'))!
    expect((insert[1] as unknown[]).slice(0, 2)).toEqual([hostId, null])
  })

  it('is idempotent: a second call returns the existing earning without a new audit row', async () => {
    const tx = fakeTx({ inserted: null, existing: earningRow() })
    const result = await recordSaleEarning(tx, {
      sourceType: 'event_ticket', sourceId: orderId, seller: { companyId: orgId }, grossMinor: 49900, currency: 'INR', availableAfter: new Date(),
    })
    expect(result).toMatchObject({ created: false, earning: { netMinor: 44910 } })
    expect(audits(tx)).toEqual([])
  })

  it('reverses an earning that was not paid out yet', async () => {
    const tx = fakeTx({ locked: earningRow({ status: 'available' }) })
    const result = await reverseSaleEarning(tx, { sourceType: 'event_ticket', sourceId: orderId, reason: 'ticket_refunded' })
    expect(result).toMatchObject({ outcome: 'reversed', earning: { status: 'reversed' } })
    expect(audits(tx)).toEqual([{ action: 'earning_reversed', amount: 44910 }])
    expect(tx.query.mock.calls.some((call) => String(call[0]).includes("'adjustment'"))).toBe(false)
  })

  it('adds a negative adjustment when the money was already paid out', async () => {
    const tx = fakeTx({ locked: earningRow({ status: 'paid' }) })
    const result = await reverseSaleEarning(tx, { sourceType: 'event_ticket', sourceId: orderId, reason: 'ticket_refunded' })
    expect(result.outcome).toBe('adjusted')
    if (result.outcome === 'adjusted') {
      expect(result.adjustment).toMatchObject({ sourceType: 'adjustment', grossMinor: -49900, platformFeeMinor: -4990, netMinor: -44910, status: 'available' })
    }
    const insert = tx.query.mock.calls.find((call) => String(call[0]).includes('insert into public.seller_earnings'))!
    expect((insert[1] as unknown[]).slice(4, 8)).toEqual([-49900, '10.00', -4990, -44910])
    expect(audits(tx)).toEqual([{ action: 'earning_adjustment_created', amount: -44910 }])
  })

  it('does nothing twice and ignores sales that never earned', async () => {
    const reversed = fakeTx({ locked: earningRow({ status: 'reversed' }) })
    await expect(reverseSaleEarning(reversed, { sourceType: 'event_ticket', sourceId: orderId, reason: 'x' })).resolves.toMatchObject({ outcome: 'already_reversed' })
    expect(audits(reversed)).toEqual([])
    const none = fakeTx({ locked: null })
    await expect(reverseSaleEarning(none, { sourceType: 'event_ticket', sourceId: orderId, reason: 'x' })).resolves.toEqual({ outcome: 'not_found' })
  })
})

describe('balances, release job and admin settings', () => {
  it('sums a seller balance per currency, counting pending rows past their hold as available', async () => {
    db.query.mockResolvedValue([{ currency: 'INR', pending_minor: '44910', available_minor: '-1000', in_payout_minor: '0', paid_minor: '90000', next_available_at: '2030-01-12T10:00:00.000Z' }])
    await expect(getSellerBalance({ companyId: orgId }, { now: new Date('2030-01-06T00:00:00.000Z') })).resolves.toEqual([
      { currency: 'INR', pendingMinor: 44910, availableMinor: -1000, inPayoutMinor: 0, paidMinor: 90000, nextAvailableAt: '2030-01-12T10:00:00.000Z' },
    ])
    const [sql, values] = db.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain("status = 'pending' and available_at <= $3::timestamptz")
    expect(values).toEqual([null, orgId, '2030-01-06T00:00:00.000Z'])
  })

  it('releases pending earnings whose hold has passed, with an audit row each', async () => {
    const tx = { query: vi.fn(async () => ({ rows: [{ count: '3' }] })) } as unknown as DatabaseQueryClient
    await expect(releaseAvailableEarnings(tx, new Date('2030-01-12T10:00:00.000Z'))).resolves.toBe(3)
    expect(RELEASE_AVAILABLE_EARNINGS_SQL).toContain("where status = 'pending' and available_at <= $1::timestamptz")
    expect(RELEASE_AVAILABLE_EARNINGS_SQL).toContain('insert into public.payment_audit_events')
  })

  it('lets an admin change the default fee and set an override, audited', async () => {
    const tx = fakeTx({})
    await expect(updatePlatformFeeSettings(tx, { defaultPercent: '12.5', holdDays: 10, actorProfileId: hostId })).resolves.toEqual({ defaultPercent: '12.50', holdDays: 10 })
    await expect(updatePlatformFeeSettings(tx, { defaultPercent: '12.5', holdDays: 400, actorProfileId: hostId })).rejects.toThrow()
    await setSellerFeeOverride(tx, { seller: { companyId: orgId }, percent: 5, note: 'Launch partner', actorProfileId: hostId })
    expect(audits(tx).map((entry) => entry.action)).toEqual(['fee_settings_updated', 'fee_override_set'])
  })
})
