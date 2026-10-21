import { createCashfreeClient } from './cashfree'
import { loadCashfreeSettings, type CashfreeSettings } from './cashfree-config'
import { cashfreeHealthStore, cashfreeReportingFetch, SETUP_REASON_TEXT, type CashfreeCallOutcome, type CashfreeHealthRecord, type CashfreeProduct, type CashfreeProductHealth } from './cashfree-health'
import { PaymentProviderError } from './types'
import { createCashfreePayoutsClient } from '@/features/payouts/cashfree-payouts-client'

/**
 * Hotfix P1: the read-only "Payments health" card on Admin › Payments. Status only: whether keys are present,
 * which environment, how Payouts authenticates, and when Cashfree last accepted a call. Never a key or a value.
 */

export type HealthTone = 'ok' | 'problem' | 'unknown'

export type PaymentsHealthLine = {
  id: 'pg_keys' | 'payouts_keys' | 'payouts_auth' | 'webhook_secret' | 'pg_last_call' | 'payouts_last_call'
  label: string
  tone: HealthTone
  value: string
  detail: string | null
}

export type PaymentsHealth = { lines: PaymentsHealthLine[]; allOk: boolean }

const environmentLabel = (environment: 'sandbox' | 'production') => (environment === 'production' ? 'PROD' : 'TEST')

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso))
}

function lastCallLine(id: 'pg_last_call' | 'payouts_last_call', label: string, configured: boolean, health: CashfreeProductHealth): PaymentsHealthLine {
  if (!configured) return { id, label, tone: 'unknown', value: 'Not set up', detail: null }
  const success = health.lastSuccessAt ? Date.parse(health.lastSuccessAt) : null
  const failure = health.lastFailureAt ? Date.parse(health.lastFailureAt) : null
  const failingNow = failure !== null && (success === null || failure > success)
  if (failingNow && health.lastFailureReason) {
    return {
      id,
      label,
      tone: 'problem',
      value: `Refused ${formatWhen(health.lastFailureAt!)}${health.lastFailureStatus ? ` (HTTP ${health.lastFailureStatus})` : ''}`,
      detail: `${SETUP_REASON_TEXT[health.lastFailureReason]}${health.lastSuccessAt ? ` Last success: ${formatWhen(health.lastSuccessAt)}.` : ' No successful call recorded yet.'}`,
    }
  }
  if (health.lastSuccessAt) return { id, label, tone: 'ok', value: `Accepted ${formatWhen(health.lastSuccessAt)}`, detail: null }
  return { id, label, tone: 'unknown', value: 'No call recorded yet', detail: 'Select Check Cashfree now to test the keys.' }
}

export function describePaymentsHealth(settings: CashfreeSettings, record: CashfreeHealthRecord): PaymentsHealth {
  const { pg, payouts } = settings
  const lines: PaymentsHealthLine[] = [
    pg
      ? { id: 'pg_keys', label: 'Payment Gateway keys', tone: 'ok', value: `Present · ${environmentLabel(pg.environment)}`, detail: null }
      : { id: 'pg_keys', label: 'Payment Gateway keys', tone: 'problem', value: 'Missing', detail: 'Add client_id and client_secret to the Cashfree secret.' },
    payouts
      ? { id: 'payouts_keys', label: 'Payouts keys', tone: 'ok', value: `Present · ${environmentLabel(payouts.environment)}`, detail: pg && pg.environment !== payouts.environment ? 'Payouts and the Payment Gateway use different environments. Check that this is intended.' : null }
      : { id: 'payouts_keys', label: 'Payouts keys', tone: 'problem', value: 'Missing', detail: 'Add payouts_client_id and payouts_client_secret to the Cashfree secret.' },
    !payouts
      ? { id: 'payouts_auth', label: 'Payouts authentication', tone: 'unknown', value: 'Not set up', detail: null }
      : payouts.publicKeyPem
        ? { id: 'payouts_auth', label: 'Payouts authentication', tone: 'ok', value: 'Signature (2FA public key)', detail: null }
        : payouts.publicKeyProblem === 'invalid'
          ? {
              id: 'payouts_auth',
              label: 'Payouts authentication',
              tone: 'problem',
              value: 'Public key present but not valid',
              detail: 'payouts_public_key is in the Cashfree secret but is not a usable RSA public key. Paste the whole .pem file Cashfree gave you, from the BEGIN line to the END line.',
            }
          : {
            id: 'payouts_auth',
            label: 'Payouts authentication',
            tone: 'problem',
            value: 'IP whitelist (no public key)',
            detail: "Our web servers have no fixed address, so an IP whitelist can't work. In Cashfree, set Payouts 2FA to Public Key and add payouts_public_key to the Cashfree secret.",
          },
    pg || payouts
      ? {
          id: 'webhook_secret',
          label: 'Webhook secret',
          tone: pg && payouts ? 'ok' : 'problem',
          value: pg && payouts ? 'Present (each product’s client secret)' : `Missing for ${pg ? 'Payouts' : 'Payment Gateway'}`,
          detail: 'Cashfree signs webhooks with the client secret of the product that sends them, so no separate webhook secret is needed.',
        }
      : { id: 'webhook_secret', label: 'Webhook secret', tone: 'problem', value: 'Missing', detail: 'No Cashfree keys are set up.' },
    lastCallLine('pg_last_call', 'Last Payment Gateway call', Boolean(pg), record.pg),
    lastCallLine('payouts_last_call', 'Last Payouts call', Boolean(payouts), record.payouts),
  ]
  return { lines, allOk: lines.every((line) => line.tone === 'ok') }
}

export async function getPaymentsHealth(deps: { loadSettings?: () => Promise<CashfreeSettings>; readRecord?: () => Promise<CashfreeHealthRecord> } = {}) {
  const [settings, record] = await Promise.all([
    (deps.loadSettings ?? (() => loadCashfreeSettings()))(),
    (deps.readRecord ?? (() => cashfreeHealthStore.read()))().catch(() => ({
      pg: { lastSuccessAt: null, lastFailureAt: null, lastFailureReason: null, lastFailureStatus: null },
      payouts: { lastSuccessAt: null, lastFailureAt: null, lastFailureReason: null, lastFailureStatus: null },
    })),
  ])
  return describePaymentsHealth(settings, record)
}

/** Ids no order or beneficiary of ours ever has: Cashfree answers 404 when it accepts our keys. */
export const PG_PROBE_ORDER_ID = 'sns_health_probe'
export const PAYOUTS_PROBE_BENEFICIARY_ID = 'snsb_health_probe'

type ProbeResult = { product: CashfreeProduct; outcome: CashfreeCallOutcome | null }

/**
 * One harmless read per product (look up an order and a beneficiary that do not exist), from this server, so the
 * answer reflects the real network path and keys. Changes nothing at Cashfree. Results are recorded at once.
 */
export async function checkCashfreeNow(deps: {
  loadSettings?: () => Promise<CashfreeSettings>
  record?: (product: CashfreeProduct, outcome: CashfreeCallOutcome) => Promise<void>
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
} = {}): Promise<ProbeResult[]> {
  const settings = await (deps.loadSettings ?? (() => loadCashfreeSettings({ useCache: false, refreshCache: true })))()
  const record = deps.record ?? ((product, outcome) => cashfreeHealthStore.record(product, outcome, { force: true }))
  const results: ProbeResult[] = []

  async function probe(product: CashfreeProduct, run: (fetchImpl: (input: string, init?: RequestInit) => Promise<Response>) => Promise<unknown>) {
    let outcome: CashfreeCallOutcome | null = null
    const fetchImpl = cashfreeReportingFetch(product, {
      fetchImpl: deps.fetchImpl,
      awaitRecord: true,
      record: async (p, value) => {
        outcome = value
        await record(p, value)
      },
    })
    try {
      await run(fetchImpl)
    } catch (error) {
      // The answer itself was already recorded by the reporting fetch; a local key error never reached Cashfree.
      if (error instanceof PaymentProviderError && error.providerMessage === 'payouts_public_key_invalid') {
        outcome = { ok: false, reason: 'public_key_invalid', status: null }
        await record(product, outcome)
      }
    }
    results.push({ product, outcome })
  }

  if (settings.pg) {
    const pg = settings.pg
    await probe('pg', (fetchImpl) => createCashfreeClient(pg, fetchImpl).getOrder(PG_PROBE_ORDER_ID))
  } else {
    results.push({ product: 'pg', outcome: null })
  }
  if (settings.payouts) {
    const payouts = settings.payouts
    await probe('payouts', (fetchImpl) => createCashfreePayoutsClient(payouts, { fetchImpl }).getBeneficiary(PAYOUTS_PROBE_BENEFICIARY_ID))
  } else {
    results.push({ product: 'payouts', outcome: null })
  }
  return results
}
