import { constants, publicEncrypt, randomUUID } from 'node:crypto'
import type { CashfreePayoutsConfig } from '@/features/payments/cashfree-config'
import { decimalAmountToMinor, minorToDecimalAmount } from '@/features/payments/currency'
import { PaymentProviderError, type CashfreeMode } from '@/features/payments/types'

/**
 * Cashfree Payouts v2 over plain HTTPS (no SDK), following
 * /home/claude/brief5/cashfree-api.txt §3 (official docs, researched 2026-09-27):
 *   POST   /beneficiary                       create beneficiary
 *   GET    /beneficiary?beneficiary_id=…      get beneficiary (or ?bank_account_number=…&bank_ifsc=…)
 *   DELETE /beneficiary?beneficiary_id=…      remove beneficiary
 *   POST   /transfers                         standard transfer (async)
 *   GET    /transfers?transfer_id=…           transfer status
 * Headers: x-client-id / x-client-secret (the PAYOUTS key pair), x-api-version 2024-01-01,
 * and x-cf-signature when a 2FA public key is configured (serverless has no static IP):
 *   Base64(RSA-OAEP(SHA-1, MGF1-SHA-1)(publicKey, clientId + "." + unixSeconds))
 * (Java "RSA/ECB/OAEPWithSHA-1AndMGF1Padding"; a fresh one per request, valid 5 minutes).
 * Amounts: integer paise here; Cashfree gets rupees with 2 decimals built from the digits.
 * Never log the account number, the secret or the signature.
 */

export const CASHFREE_PAYOUTS_API_VERSION = '2024-01-01'
export const CASHFREE_PAYOUTS_BASE_URLS: Record<CashfreeMode, string> = {
  sandbox: 'https://sandbox.cashfree.com/payout',
  production: 'https://api.cashfree.com/payout',
}

const REQUEST_TIMEOUT_MS = 20_000
/** transfer_remarks: max 70 chars, alphanumeric and spaces only. */
const TRANSFER_REMARKS = 'Sea N Shore seller payout'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type CashfreeBeneficiaryStatus = 'VERIFIED' | 'INITIATED' | 'INVALID' | 'FAILED' | 'CANCELLED' | 'DELETED'

export type CashfreeBeneficiary = {
  beneficiaryId: string
  status: CashfreeBeneficiaryStatus | string | null
  /** Only what Cashfree echoes back, already masked for storage (never the full number). */
  bankAccountLast4: string | null
  bankIfsc: string | null
  vpa: string | null
}

export type CashfreeTransfer = {
  transferId: string
  cfTransferId: string | null
  status: string
  statusCode: string | null
  statusDescription: string | null
  utr: string | null
  amountMinor: number | null
  transferMode: string | null
}

export type TransferMode = 'banktransfer' | 'upi'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * X-Cf-Signature for Payouts 2FA. RSA-OAEP with SHA-1 (and MGF1-SHA-1), matching the
 * Java sample's "RSA/ECB/OAEPWithSHA-1AndMGF1Padding" and PHP OPENSSL_PKCS1_OAEP_PADDING.
 */
export function cashfreePayoutSignature(clientId: string, publicKeyPem: string, now: Date = new Date()) {
  const data = `${clientId}.${Math.floor(now.getTime() / 1000)}`
  return publicEncrypt({ key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(data, 'utf8')).toString('base64')
}

export function mapCashfreeBeneficiary(value: unknown): CashfreeBeneficiary {
  const payload = record(value)
  const beneficiaryId = text(payload.beneficiary_id)
  if (!beneficiaryId) throw new PaymentProviderError('provider_response_invalid')
  const instrument = record(payload.beneficiary_instrument_details)
  const account = text(instrument.bank_account_number)
  return {
    beneficiaryId,
    status: text(payload.beneficiary_status),
    bankAccountLast4: account ? account.replace(/[^0-9]/g, '').slice(-4) || null : null,
    bankIfsc: text(instrument.bank_ifsc),
    vpa: text(instrument.vpa),
  }
}

export function mapCashfreeTransfer(value: unknown): CashfreeTransfer {
  const payload = record(value)
  const transferId = text(payload.transfer_id)
  const status = text(payload.status)
  if (!transferId || !status) throw new PaymentProviderError('provider_response_invalid')
  return {
    transferId,
    cfTransferId: text(payload.cf_transfer_id),
    status: status.toUpperCase(),
    statusCode: text(payload.status_code),
    statusDescription: text(payload.status_description),
    utr: text(payload.transfer_utr) ?? text(payload.utr),
    amountMinor: decimalAmountToMinor(payload.transfer_amount),
    transferMode: text(payload.transfer_mode),
  }
}

/** A 4xx that means Cashfree definitely did not create the transfer. 409 (duplicate) and 429 (slow down) are not. */
export function isDefiniteRejection(error: unknown) {
  return error instanceof PaymentProviderError
    && error.code === 'provider_request_failed'
    && error.status !== null
    && [400, 401, 403, 404, 422].includes(error.status)
}

export function createCashfreePayoutsClient(config: CashfreePayoutsConfig, options: { fetchImpl?: FetchLike; now?: () => Date } = {}) {
  const base = CASHFREE_PAYOUTS_BASE_URLS[config.environment]
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? (() => new Date())

  async function request(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'x-api-version': CASHFREE_PAYOUTS_API_VERSION,
      'x-client-id': config.clientId,
      'x-client-secret': config.clientSecret,
      'x-request-id': randomUUID(),
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (config.publicKeyPem) {
      try {
        headers['x-cf-signature'] = cashfreePayoutSignature(config.clientId, config.publicKeyPem, now())
      } catch {
        // A malformed key is a setup problem, not a Cashfree answer. Nothing was sent.
        throw new PaymentProviderError('provider_request_failed', 401, 'payouts_public_key_invalid')
      }
    }
    let response: Response
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      })
    } catch {
      throw new PaymentProviderError('provider_unreachable')
    }
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    if (!response.ok) {
      const data = record(payload)
      throw new PaymentProviderError('provider_request_failed', response.status, text(data.message) ?? text(data.code))
    }
    return payload
  }

  function beneficiaryQuery(beneficiaryId: string) {
    if (!/^[A-Za-z0-9_]{3,50}$/.test(beneficiaryId)) throw new PaymentProviderError('provider_request_failed', 400, 'beneficiary_id_invalid')
    return `?beneficiary_id=${encodeURIComponent(beneficiaryId)}`
  }

  async function getBeneficiary(beneficiaryId: string): Promise<CashfreeBeneficiary | null> {
    try {
      return mapCashfreeBeneficiary(await request('GET', `/beneficiary${beneficiaryQuery(beneficiaryId)}`))
    } catch (error) {
      if (error instanceof PaymentProviderError && error.status === 404) return null
      throw error
    }
  }

  async function getTransfer(transferId: string): Promise<CashfreeTransfer | null> {
    if (!/^[A-Za-z0-9_]{3,40}$/.test(transferId)) throw new PaymentProviderError('provider_request_failed', 400, 'transfer_id_invalid')
    try {
      const transfer = mapCashfreeTransfer(await request('GET', `/transfers?transfer_id=${encodeURIComponent(transferId)}`))
      if (transfer.transferId !== transferId) throw new PaymentProviderError('provider_response_invalid')
      return transfer
    } catch (error) {
      if (error instanceof PaymentProviderError && error.status === 404) return null
      throw error
    }
  }

  return {
    environment: config.environment,

    /**
     * Creates a beneficiary. On 409 (the id or these bank details already exist at
     * Cashfree) the caller decides what to reuse; the error is passed through.
     */
    async createBeneficiary(input: {
      beneficiaryId: string
      name: string
      bankAccountNumber?: string
      bankIfsc?: string
      vpa?: string
    }): Promise<CashfreeBeneficiary> {
      if (!/^[A-Za-z0-9_]{3,50}$/.test(input.beneficiaryId)) throw new PaymentProviderError('provider_request_failed', 400, 'beneficiary_id_invalid')
      const instrument = input.vpa
        ? { vpa: input.vpa }
        : { bank_account_number: input.bankAccountNumber, bank_ifsc: input.bankIfsc }
      if (!input.vpa && (!input.bankAccountNumber || !input.bankIfsc)) throw new PaymentProviderError('provider_request_failed', 400, 'instrument_required')
      const beneficiary = mapCashfreeBeneficiary(await request('POST', '/beneficiary', {
        beneficiary_id: input.beneficiaryId,
        beneficiary_name: input.name.slice(0, 100),
        beneficiary_instrument_details: instrument,
      }))
      if (beneficiary.beneficiaryId !== input.beneficiaryId) throw new PaymentProviderError('provider_response_invalid')
      return beneficiary
    },

    getBeneficiary,

    /** Finds an existing beneficiary for these bank details (GET by account number + IFSC). */
    async findBeneficiaryByBankAccount(bankAccountNumber: string, bankIfsc: string): Promise<CashfreeBeneficiary | null> {
      try {
        return mapCashfreeBeneficiary(await request('GET', `/beneficiary?bank_account_number=${encodeURIComponent(bankAccountNumber)}&bank_ifsc=${encodeURIComponent(bankIfsc)}`))
      } catch (error) {
        if (error instanceof PaymentProviderError && error.status === 404) return null
        throw error
      }
    },

    /** Removes a beneficiary. Already gone (404) counts as removed. */
    async removeBeneficiary(beneficiaryId: string): Promise<{ removed: boolean }> {
      try {
        await request('DELETE', `/beneficiary${beneficiaryQuery(beneficiaryId)}`)
        return { removed: true }
      } catch (error) {
        if (error instanceof PaymentProviderError && error.status === 404) return { removed: false }
        throw error
      }
    },

    /**
     * Standard transfer to a saved beneficiary. The transfer_id is ours and derived from
     * the payout id: if Cashfree already has it (409), its status is read instead, so a
     * retry never creates a second transfer.
     */
    async createTransfer(input: { transferId: string; amountMinor: number; beneficiaryId: string; mode: TransferMode }): Promise<CashfreeTransfer> {
      if (!/^[A-Za-z0-9_]{3,40}$/.test(input.transferId)) throw new PaymentProviderError('provider_request_failed', 400, 'transfer_id_invalid')
      if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 100) throw new PaymentProviderError('provider_request_failed', 400, 'transfer_amount_invalid')
      try {
        const transfer = mapCashfreeTransfer(await request('POST', '/transfers', {
          transfer_id: input.transferId,
          transfer_amount: minorToDecimalAmount(input.amountMinor),
          transfer_currency: 'INR',
          transfer_mode: input.mode,
          beneficiary_details: { beneficiary_id: input.beneficiaryId },
          transfer_remarks: TRANSFER_REMARKS,
        }))
        if (transfer.transferId !== input.transferId) throw new PaymentProviderError('provider_response_invalid')
        return transfer
      } catch (error) {
        if (error instanceof PaymentProviderError && error.status === 409) {
          const existing = await getTransfer(input.transferId)
          if (existing) return existing
        }
        throw error
      }
    },

    getTransfer,
  }
}

export type CashfreePayoutsClient = ReturnType<typeof createCashfreePayoutsClient>
