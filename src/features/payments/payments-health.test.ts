import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ query: vi.fn() }))

import type { CashfreeSettings } from './cashfree-config'
import type { CashfreeCallOutcome, CashfreeHealthRecord } from './cashfree-health'
import { checkCashfreeNow, describePaymentsHealth, PAYOUTS_PROBE_BENEFICIARY_ID, PG_PROBE_ORDER_ID } from './payments-health'

const PEM = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----'
const empty = { lastSuccessAt: null, lastFailureAt: null, lastFailureReason: null, lastFailureStatus: null }

function settings(overrides: Partial<CashfreeSettings> = {}): CashfreeSettings {
  return {
    pg: { clientId: 'CF-PG-ID', clientSecret: 'pg-secret-value', environment: 'production', international: false },
    payouts: { clientId: 'CF-PAYOUTS-ID', clientSecret: 'payouts-secret-value', publicKeyPem: PEM, environment: 'production' },
    preferredProvider: null,
    ...overrides,
  }
}

const healthy: CashfreeHealthRecord = {
  pg: { ...empty, lastSuccessAt: '2026-10-20T09:00:00.000Z' },
  payouts: { ...empty, lastSuccessAt: '2026-10-20T09:30:00.000Z' },
}

describe('Payments health card (hotfix P1)', () => {
  it('is all green with both key pairs, the signature mode and accepted calls, and never shows a key', () => {
    const health = describePaymentsHealth(settings(), healthy)
    expect(health.allOk).toBe(true)
    expect(health.lines.map((line) => [line.id, line.tone, line.value])).toEqual([
      ['pg_keys', 'ok', 'Present · PROD'],
      ['payouts_keys', 'ok', 'Present · PROD'],
      ['payouts_auth', 'ok', 'Signature (2FA public key)'],
      ['webhook_secret', 'ok', 'Present (each product’s client secret)'],
      ['pg_last_call', 'ok', 'Accepted 20 Oct 2026, 2:30 pm'],
      ['payouts_last_call', 'ok', 'Accepted 20 Oct 2026, 3:00 pm'],
    ])
    expect(JSON.stringify(health)).not.toMatch(/CF-PG-ID|CF-PAYOUTS-ID|secret-value|BEGIN PUBLIC KEY/)
  })

  it('flags the IP whitelist mode, which cannot work without a fixed server address', () => {
    const health = describePaymentsHealth(settings({ payouts: { ...settings().payouts!, publicKeyPem: null } }), healthy)
    const line = health.lines.find((item) => item.id === 'payouts_auth')!
    expect(line).toMatchObject({ tone: 'problem', value: 'IP whitelist (no public key)' })
    expect(line.detail).toMatch(/no fixed address/)
    expect(health.allOk).toBe(false)
  })

  it('tells a public key that is present but unusable apart from a missing one', () => {
    const health = describePaymentsHealth(settings({ payouts: { ...settings().payouts!, publicKeyPem: null, publicKeyProblem: 'invalid' } }), healthy)
    const line = health.lines.find((item) => item.id === 'payouts_auth')!
    expect(line).toMatchObject({ tone: 'problem', value: 'Public key present but not valid' })
    expect(line.detail).toMatch(/from the BEGIN line to the END line/)
    expect(health.allOk).toBe(false)
  })

  it('shows the last refusal in plain words while it is newer than the last success', () => {
    const health = describePaymentsHealth(settings(), {
      ...healthy,
      payouts: { lastSuccessAt: null, lastFailureAt: '2026-10-20T10:00:00.000Z', lastFailureReason: 'ip_not_whitelisted', lastFailureStatus: 403 },
    })
    const line = health.lines.find((item) => item.id === 'payouts_last_call')!
    expect(line).toMatchObject({ tone: 'problem', value: 'Refused 20 Oct 2026, 3:30 pm (HTTP 403)' })
    expect(line.detail).toMatch(/not on the Payouts IP whitelist.*No successful call recorded yet\./)
  })

  it('shows missing keys, the TEST environment and a mismatch between products', () => {
    const health = describePaymentsHealth(settings({ pg: null, payouts: { ...settings().payouts!, environment: 'sandbox' } }), { pg: empty, payouts: empty })
    expect(health.lines.find((item) => item.id === 'pg_keys')).toMatchObject({ tone: 'problem', value: 'Missing' })
    expect(health.lines.find((item) => item.id === 'payouts_keys')).toMatchObject({ tone: 'ok', value: 'Present · TEST' })
    expect(health.lines.find((item) => item.id === 'webhook_secret')).toMatchObject({ tone: 'problem', value: 'Missing for Payment Gateway' })
    expect(health.lines.find((item) => item.id === 'payouts_last_call')).toMatchObject({ tone: 'unknown', value: 'No call recorded yet' })
  })
})

describe('Check Cashfree now', () => {
  function json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }

  it('reads an order and a beneficiary that do not exist: 404 means our keys work; nothing is created', async () => {
    const urls: string[] = []
    const recorded: Array<[string, CashfreeCallOutcome]> = []
    const results = await checkCashfreeNow({
      loadSettings: async () => settings({ payouts: { ...settings().payouts!, publicKeyPem: null } }),
      record: async (product, outcome) => { recorded.push([product, outcome]) },
      fetchImpl: async (url, init) => {
        urls.push(`${init?.method ?? 'GET'} ${url}`)
        return url.includes('/payout/') ? json(403, { message: 'IP not whitelisted your current IP is 13.200.1.2' }) : json(404, { message: 'order not found' })
      },
    })
    expect(urls).toEqual([
      `GET https://api.cashfree.com/pg/orders/${PG_PROBE_ORDER_ID}`,
      `GET https://api.cashfree.com/payout/beneficiary?beneficiary_id=${PAYOUTS_PROBE_BENEFICIARY_ID}`,
    ])
    expect(results).toEqual([
      { product: 'pg', outcome: { ok: true } },
      { product: 'payouts', outcome: { ok: false, reason: 'ip_not_whitelisted', status: 403 } },
    ])
    expect(recorded).toEqual([['pg', { ok: true }], ['payouts', { ok: false, reason: 'ip_not_whitelisted', status: 403 }]])
  })

  it('reports a malformed public key without calling Cashfree, and skips products that are not set up', async () => {
    const fetchImpl = vi.fn()
    const results = await checkCashfreeNow({
      loadSettings: async () => settings({ pg: null, payouts: { ...settings().payouts!, publicKeyPem: '-----BEGIN PUBLIC KEY-----\nnot a key\n-----END PUBLIC KEY-----' } }),
      record: async () => undefined,
      fetchImpl,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(results).toEqual([
      { product: 'pg', outcome: null },
      { product: 'payouts', outcome: { ok: false, reason: 'public_key_invalid', status: null } },
    ])
  })
})
