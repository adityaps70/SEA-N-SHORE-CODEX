import type { DatabaseQueryClient } from '@/lib/db/client'
import type { CashfreePayoutsConfig } from '@/features/payments/cashfree-config'
import { verifyCashfreeSignature } from '@/features/payments/cashfree'
import { decimalAmountToMinor } from '@/features/payments/currency'
import { PaymentVerificationError, type HeaderLookup } from '@/features/payments/types'
import { recordWebhookDelivery } from '@/features/payments/webhook-deliveries'
import { applyTransferReport, type TransferReport } from './payout-repository'
import { payoutIdFromTransferId } from './payout-rules'

/**
 * Cashfree Payouts webhooks v2 (cashfree-api.txt §3.5):
 *   { "data": { transfer_id, cf_transfer_id, status, status_code, status_description,
 *               transfer_amount, transfer_utr, updated_on, ... }, "event_time", "type" }
 * Signature: Base64(HMAC-SHA256(key = Payouts client secret, timestamp + raw body)) in
 * x-webhook-signature / x-webhook-timestamp — the same recipe as the payment gateway,
 * so the shared verifier is reused with the PAYOUTS secret.
 */

const TRANSFER_TYPES = new Set(['TRANSFER_ACKNOWLEDGED', 'TRANSFER_SUCCESS', 'TRANSFER_FAILED', 'TRANSFER_REVERSED', 'TRANSFER_REJECTED'])

const STATUS_BY_TYPE: Record<string, string> = {
  TRANSFER_SUCCESS: 'SUCCESS',
  TRANSFER_FAILED: 'FAILED',
  TRANSFER_REVERSED: 'REVERSED',
  TRANSFER_REJECTED: 'REJECTED',
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export type ParsedPayoutWebhook = {
  type: string
  transferId: string | null
  deliveryId: string
  report: TransferReport | null
}

/** Normalizes a Payouts webhook body. Call only after the signature was verified. */
export function parsePayoutWebhook(rawBody: string): ParsedPayoutWebhook | null {
  let payload: Record<string, unknown>
  try {
    payload = record(JSON.parse(rawBody))
  } catch {
    return null
  }
  const data = record(payload.data)
  const type = text(payload.type) ?? text(data.type) ?? 'unknown'
  const transferId = text(data.transfer_id)
  if (!TRANSFER_TYPES.has(type) || !transferId) return { type, transferId, deliveryId: `${type}:${transferId ?? 'none'}`, report: null }
  // An acknowledgement without a status is informational: keep it "processing" (never releases money).
  const status = (text(data.status) ?? STATUS_BY_TYPE[type] ?? 'PENDING').toUpperCase()
  const stamp = text(data.updated_on) ?? text(payload.event_time) ?? ''
  return {
    type,
    transferId,
    deliveryId: `payouts:${type}:${transferId}:${status}:${stamp}`,
    report: {
      status,
      statusCode: text(data.status_code),
      statusDescription: text(data.status_description),
      cfTransferId: text(data.cf_transfer_id),
      utr: text(data.transfer_utr) ?? text(data.utr),
      amountMinor: data.transfer_amount === undefined ? null : decimalAmountToMinor(data.transfer_amount),
    },
  }
}

export type PayoutWebhookResult =
  | { status: 'handled'; type: string; payoutId: string; changed: boolean }
  | { status: 'ignored'; type: string; reason: string }
  | { status: 'duplicate'; type: string }

export function createPayoutWebhookHandler(deps: {
  loadConfig: () => Promise<CashfreePayoutsConfig | null>
  transaction: <T>(work: (tx: DatabaseQueryClient) => Promise<T>) => Promise<T>
}) {
  /**
   * Returns null when payouts are not set up (answer 503). Throws PaymentVerificationError
   * for a bad signature (answer 400) and database errors (answer 5xx so Cashfree retries;
   * the delivery record rolls back with the failed transaction).
   */
  return async function handlePayoutWebhook(input: { rawBody: string; headers: HeaderLookup }): Promise<PayoutWebhookResult | null> {
    const config = await deps.loadConfig()
    if (!config) return null
    const verified = verifyCashfreeSignature({
      secret: config.clientSecret,
      rawBody: input.rawBody,
      timestamp: input.headers.get('x-webhook-timestamp'),
      signature: input.headers.get('x-webhook-signature'),
    })
    if (!verified) throw new PaymentVerificationError()

    const parsed = parsePayoutWebhook(input.rawBody)
    if (!parsed) return { status: 'ignored', type: 'unknown', reason: 'invalid_json' }
    if (!parsed.report || !parsed.transferId) return { status: 'ignored', type: parsed.type, reason: 'not_needed' }
    const payoutId = payoutIdFromTransferId(parsed.transferId)
    if (!payoutId) return { status: 'ignored', type: parsed.type, reason: 'not_a_payout' }
    const report = parsed.report

    const outcome = await deps.transaction(async (tx) => {
      if (!await recordWebhookDelivery(tx, 'cashfree', parsed.deliveryId, parsed.type)) return 'duplicate' as const
      return applyTransferReport(tx, { payoutId, report, actor: { type: 'provider' }, source: 'webhook' })
    })
    if (outcome === 'duplicate') return { status: 'duplicate', type: parsed.type }
    if (!outcome) return { status: 'ignored', type: parsed.type, reason: 'unknown_payout' }
    return { status: 'handled', type: parsed.type, payoutId, changed: outcome.changed }
  }
}
