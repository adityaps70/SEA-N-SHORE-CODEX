import { query as databaseQuery } from '@/lib/db/client'

/**
 * Hotfix P1: what happened on our last Cashfree calls, for Admin › Payments › "Payments health".
 *
 * Every Cashfree request (Payment Gateway and Payouts) goes through cashfreeReportingFetch, which notes whether
 * Cashfree accepted our keys. A refusal (401/403) is turned into a reason code from Cashfree's message, so admins
 * see "IP not whitelisted" or "signature mismatch" instead of a generic setup error. Only the outcome, a reason
 * code and a time are kept (one public.site_settings row, key payments_health): never a key, a request body,
 * Cashfree's raw message or anything a member typed.
 */

export type CashfreeProduct = 'pg' | 'payouts'

export type CashfreeSetupReason =
  | 'ip_not_whitelisted'
  | 'signature_missing'
  | 'signature_mismatch'
  | 'public_key_invalid'
  | 'invalid_keys'
  | 'payouts_not_activated'
  | 'forbidden'
  | 'unreachable'
  | 'cashfree_error'

export type CashfreeCallOutcome = { ok: true } | { ok: false; reason: CashfreeSetupReason; status: number | null }

export type CashfreeProductHealth = {
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastFailureReason: CashfreeSetupReason | null
  lastFailureStatus: number | null
}

export type CashfreeHealthRecord = Record<CashfreeProduct, CashfreeProductHealth>

export const HEALTH_SETTING_KEY = 'payments_health'

/** Plain words for admins. Never shown to members. */
export const SETUP_REASON_TEXT: Record<CashfreeSetupReason, string> = {
  ip_not_whitelisted: 'Cashfree refused the call because our server address is not on the Payouts IP whitelist. Our servers have no fixed address, so switch Payouts 2FA to Public Key instead.',
  signature_missing: 'Cashfree expects a 2FA signature, but no Payouts public key is in the Cashfree secret. Add payouts_public_key.',
  signature_mismatch: 'Cashfree could not match the 2FA signature. The public key must come from the same environment as the Payouts keys, and the oldest Payouts client ID must be used.',
  public_key_invalid: 'The Payouts public key in the Cashfree secret is not a valid PEM key, so nothing was sent. Paste the whole downloaded .pem text, including the BEGIN and END lines.',
  invalid_keys: 'Cashfree did not accept the client ID and secret. Check that they are the right pair and from the same environment (TEST or PROD) as the setting.',
  payouts_not_activated: 'Cashfree says Payouts is not activated on this account. Activate Payouts in the Cashfree dashboard.',
  forbidden: 'Cashfree refused the call (403) without saying why. Check the Payouts 2FA setting and that the keys are active.',
  unreachable: 'Cashfree could not be reached.',
  cashfree_error: 'Cashfree had an error on its side.',
}

/** Maps a Cashfree refusal to a reason code. The message itself is never stored or logged. */
export function classifyCashfreeSetupFailure(message: string | null, status: number | null): CashfreeSetupReason {
  const text = (message ?? '').toLowerCase()
  if (text === 'payouts_public_key_invalid') return 'public_key_invalid'
  if (/\bip\b.*(not\s+)?whitelist|whitelist.*\bip\b/.test(text)) return 'ip_not_whitelisted'
  if (/signature\s+(is\s+)?missing|missing\s+signature/.test(text)) return 'signature_missing'
  if (/signature\s+mis-?match|invalid\s+signature|signature.*(invalid|expired)/.test(text)) return 'signature_mismatch'
  if (/not\s+(enabled|activated)|inactive|not\s+active/.test(text) && /payout|product|service|account|feature/.test(text)) return 'payouts_not_activated'
  if (/authenticat|client\s*id|client\s*secret|credential|unauthori[sz]ed|invalid\s+(key|token)/.test(text)) return 'invalid_keys'
  return status === 401 ? 'invalid_keys' : 'forbidden'
}

function messageOf(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>
  for (const key of ['message', 'code', 'error']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/** Outcome of one Cashfree HTTP response: any answer below 500 except 401/403 means our keys were accepted. */
export async function cashfreeResponseOutcome(response: Response): Promise<CashfreeCallOutcome> {
  if (response.status === 401 || response.status === 403) {
    let message: string | null = null
    try {
      message = messageOf(await response.clone().json())
    } catch {
      message = null
    }
    return { ok: false, reason: classifyCashfreeSetupFailure(message, response.status), status: response.status }
  }
  if (response.status >= 500) return { ok: false, reason: 'cashfree_error', status: response.status }
  return { ok: true }
}

type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>
type Recorder = (product: CashfreeProduct, outcome: CashfreeCallOutcome) => Promise<void>

/** Writes at most once a minute per product and outcome, so busy checkout pages do not write on every call. */
const WRITE_INTERVAL_MS = 60_000

export function createCashfreeHealthStore(input: { query?: Query; now?: () => number } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))
  const now = input.now ?? Date.now
  const lastWrite = new Map<string, number>()

  async function record(product: CashfreeProduct, outcome: CashfreeCallOutcome, options: { force?: boolean } = {}) {
    const slot = `${product}:${outcome.ok ? 'ok' : outcome.reason}`
    const at = now()
    if (!options.force && (lastWrite.get(slot) ?? -Infinity) > at - WRITE_INTERVAL_MS) return
    lastWrite.set(slot, at)
    const stamp = new Date(at).toISOString()
    const patch = outcome.ok
      ? { lastSuccessAt: stamp }
      : { lastFailureAt: stamp, lastFailureReason: outcome.reason, lastFailureStatus: outcome.status }
    // A system row: no updated_by and no audit event (it is not a setting anyone changes).
    await queryRows(
      `insert into public.site_settings (key, value, updated_at)
       values ($1, jsonb_build_object($2::text, $3::jsonb), now())
       on conflict (key) do update
         set value = public.site_settings.value
               || jsonb_build_object($2::text, coalesce(public.site_settings.value -> $2::text, '{}'::jsonb) || $3::jsonb),
             updated_at = now()`,
      [HEALTH_SETTING_KEY, product, JSON.stringify(patch)],
    )
  }

  async function read(): Promise<CashfreeHealthRecord> {
    const rows = await queryRows(`select value from public.site_settings where key = $1`, [HEALTH_SETTING_KEY])
    const raw = rows[0]?.value
    const value = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown> | undefined
    return { pg: productHealth(value?.pg), payouts: productHealth(value?.payouts) }
  }

  return { record, read }
}

const REASONS = new Set(Object.keys(SETUP_REASON_TEXT))

function productHealth(value: unknown): CashfreeProductHealth {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const time = (key: string) => (typeof record[key] === 'string' && !Number.isNaN(Date.parse(record[key] as string)) ? record[key] as string : null)
  const reason = typeof record.lastFailureReason === 'string' && REASONS.has(record.lastFailureReason) ? record.lastFailureReason as CashfreeSetupReason : null
  const status = typeof record.lastFailureStatus === 'number' ? record.lastFailureStatus : null
  return { lastSuccessAt: time('lastSuccessAt'), lastFailureAt: time('lastFailureAt'), lastFailureReason: reason, lastFailureStatus: status }
}

export const cashfreeHealthStore = createCashfreeHealthStore()

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * fetch for the Cashfree clients that notes each outcome. Recording never changes the call: its errors are
 * swallowed (logged by name only) and it does not delay the response.
 */
export function cashfreeReportingFetch(
  product: CashfreeProduct,
  options: { fetchImpl?: FetchLike; record?: Recorder; awaitRecord?: boolean } = {},
): FetchLike {
  const fetchImpl = options.fetchImpl ?? fetch
  const record: Recorder = options.record ?? ((p, outcome) => cashfreeHealthStore.record(p, outcome))
  const note = async (outcome: CashfreeCallOutcome) => {
    const saving = record(product, outcome).catch((error: unknown) => {
      console.error('payments_health_record_failed', { product, name: error instanceof Error ? error.name : null })
    })
    // Normal calls never wait for the write; the admin check does, so the card shows its answer at once.
    if (options.awaitRecord) await saving
  }
  return async (input, init) => {
    let response: Response
    try {
      response = await fetchImpl(input, init)
    } catch (error) {
      await note({ ok: false, reason: 'unreachable', status: null })
      throw error
    }
    await note(await cashfreeResponseOutcome(response))
    return response
  }
}
