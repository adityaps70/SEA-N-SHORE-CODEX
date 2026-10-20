import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ query: vi.fn() }))

import { cashfreeReportingFetch, classifyCashfreeSetupFailure, createCashfreeHealthStore, HEALTH_SETTING_KEY, type CashfreeCallOutcome } from './cashfree-health'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('classifying a Cashfree refusal (hotfix P1)', () => {
  it.each([
    ['IP not whitelisted your current IP is 13.200.1.2', 403, 'ip_not_whitelisted'],
    ['Signature missing in the request', 403, 'signature_missing'],
    ['Signature Mismatched', 401, 'signature_mismatch'],
    ['authentication Failed', 401, 'invalid_keys'],
    ['Invalid clientId and clientSecret combination', 401, 'invalid_keys'],
    ['Payouts product is not activated for this account', 403, 'payouts_not_activated'],
    ['payouts_public_key_invalid', 401, 'public_key_invalid'],
    [null, 401, 'invalid_keys'],
    [null, 403, 'forbidden'],
  ] as const)('%s (%i) -> %s', (message, status, reason) => {
    expect(classifyCashfreeSetupFailure(message, status)).toBe(reason)
  })
})

describe('the reporting fetch', () => {
  it('records accepted calls, refusals with a reason, Cashfree errors and network failures, and passes the answer through', async () => {
    const outcomes: CashfreeCallOutcome[] = []
    const record = async (_product: string, outcome: CashfreeCallOutcome) => { outcomes.push(outcome) }
    const answers = [json(404, { message: 'beneficiary does not exist' }), json(403, { message: 'IP not whitelisted your current IP is 1.2.3.4' }), json(502, {}), json(200, { ok: true })]
    const fetchImpl = vi.fn(async () => answers.shift()!)
    const reporting = cashfreeReportingFetch('payouts', { fetchImpl, record, awaitRecord: true })

    expect((await reporting('https://api.cashfree.com/payout/beneficiary?beneficiary_id=x')).status).toBe(404)
    const refused = await reporting('https://api.cashfree.com/payout/beneficiary')
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ message: 'IP not whitelisted your current IP is 1.2.3.4' })
    await reporting('https://api.cashfree.com/payout/transfers')
    await reporting('https://api.cashfree.com/payout/transfers')
    const failing = cashfreeReportingFetch('payouts', { fetchImpl: async () => { throw new TypeError('fetch failed') }, record, awaitRecord: true })
    await expect(failing('https://api.cashfree.com/payout/transfers')).rejects.toThrow('fetch failed')

    expect(outcomes).toEqual([
      { ok: true },
      { ok: false, reason: 'ip_not_whitelisted', status: 403 },
      { ok: false, reason: 'cashfree_error', status: 502 },
      { ok: true },
      { ok: false, reason: 'unreachable', status: null },
    ])
  })

  it('never lets a failed write change the Cashfree call', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const reporting = cashfreeReportingFetch('pg', { fetchImpl: async () => json(200, {}), record: async () => { throw new Error('db down') }, awaitRecord: true })
    expect((await reporting('https://api.cashfree.com/pg/orders/x')).status).toBe(200)
    expect(error).toHaveBeenCalledWith('payments_health_record_failed', { product: 'pg', name: 'Error' })
  })
})

describe('the health store', () => {
  it('keeps only times, a reason code and a status, at most once a minute per outcome', async () => {
    const writes: Array<readonly unknown[]> = []
    let now = Date.parse('2026-10-20T10:00:00Z')
    const store = createCashfreeHealthStore({ query: async (_text, values) => { writes.push(values ?? []); return [] }, now: () => now })
    await store.record('payouts', { ok: false, reason: 'ip_not_whitelisted', status: 403 })
    await store.record('payouts', { ok: false, reason: 'ip_not_whitelisted', status: 403 })
    now += 61_000
    await store.record('payouts', { ok: false, reason: 'ip_not_whitelisted', status: 403 })
    await store.record('payouts', { ok: true })
    await store.record('payouts', { ok: true }, { force: false })
    await store.record('payouts', { ok: true }, { force: true })
    expect(writes).toHaveLength(4)
    expect(writes[0]).toEqual([HEALTH_SETTING_KEY, 'payouts', JSON.stringify({ lastFailureAt: '2026-10-20T10:00:00.000Z', lastFailureReason: 'ip_not_whitelisted', lastFailureStatus: 403 })])
    expect(writes[2]).toEqual([HEALTH_SETTING_KEY, 'payouts', JSON.stringify({ lastSuccessAt: '2026-10-20T10:01:01.000Z' })])
  })

  it('reads the record back and ignores anything that is not a known value', async () => {
    const store = createCashfreeHealthStore({
      query: async () => [{ value: { payouts: { lastSuccessAt: '2026-10-20T10:00:00.000Z', lastFailureReason: 'made_up', lastFailureAt: 'yesterday' }, pg: 'nonsense' } }],
    })
    expect(await store.read()).toEqual({
      pg: { lastSuccessAt: null, lastFailureAt: null, lastFailureReason: null, lastFailureStatus: null },
      payouts: { lastSuccessAt: '2026-10-20T10:00:00.000Z', lastFailureAt: null, lastFailureReason: null, lastFailureStatus: null },
    })
  })
})
