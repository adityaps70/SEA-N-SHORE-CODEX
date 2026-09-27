import { z } from 'zod'
import type { Seller } from '@/features/payments/earnings'
import { formatMoney } from '@/features/payments/currency'

/**
 * Pure rules for seller payouts: identifiers, validation of payout details, masking,
 * status mapping and plain-language labels. No database or network access here.
 */

export type PayoutMethod = 'bank' | 'upi'
export type PayoutStatus = 'draft' | 'processing' | 'success' | 'failed' | 'reversed' | 'cancelled'
export type PayoutAccountStatus = 'active' | 'removed'

export const OPEN_PAYOUT_STATUSES: readonly PayoutStatus[] = ['draft', 'processing']
export const DEFAULT_MIN_PAYOUT_MINOR = 10_000
/** Two sends of the same draft this close together are treated as one (double click). */
export const DISPATCH_RETRY_AFTER_MS = 2 * 60_000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Cashfree transfer_id for a payout: "snspo_" + the payout uuid without dashes (38 chars, [A-Za-z0-9_]). */
export function transferIdForPayout(payoutId: string) {
  if (!UUID.test(payoutId)) throw new RangeError('payout_id_invalid')
  return `snspo_${payoutId.replace(/-/g, '').toLowerCase()}`
}

export function isPayoutTransferId(value: string) {
  return /^snspo_[0-9a-f]{32}$/.test(value)
}

/** The payout uuid behind a transfer id, or null. */
export function payoutIdFromTransferId(value: string) {
  if (!isPayoutTransferId(value)) return null
  const hex = value.slice(6)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Cashfree beneficiary_id for a new payout account: "snsb_" + a uuid without dashes (37 chars). */
export function beneficiaryIdFor(accountId: string) {
  if (!UUID.test(accountId)) throw new RangeError('account_id_invalid')
  return `snsb_${accountId.replace(/-/g, '').toLowerCase()}`
}

/** "profile:<uuid>" or "company:<uuid>" — how a seller travels in URLs and forms. */
export function sellerKey(seller: Seller) {
  return seller.companyId ? `company:${seller.companyId}` : `profile:${seller.profileId}`
}

export function parseSellerKey(value: unknown): Seller | null {
  if (typeof value !== 'string') return null
  const match = /^(profile|company):(.+)$/.exec(value.trim())
  if (!match || !UUID.test(match[2])) return null
  const id = match[2].toLowerCase()
  return match[1] === 'company' ? { companyId: id } : { profileId: id }
}

export function sameSeller(a: Seller, b: Seller) {
  return sellerKey(a) === sellerKey(b)
}

// ---------------------------------------------------------------------------
// Payout details the seller types. Cashfree rules (cashfree-api.txt §3.3):
// beneficiary_name letters and spaces only (max 100); bank_account_number 4-25
// alphanumeric (transfers: 9-18); IFSC 4 letters + "0" + 6 alphanumerics; vpa.
// ---------------------------------------------------------------------------

export const HOLDER_NAME_MESSAGE = 'Enter the name exactly as it appears on the account, using letters and spaces only (3 to 100 characters, no dots or numbers).'
export const ACCOUNT_NUMBER_MESSAGE = 'Enter the account number using digits only (9 to 18 digits).'
export const ACCOUNT_CONFIRM_MESSAGE = 'The two account numbers do not match. Type the account number again.'
export const IFSC_MESSAGE = 'Enter the 11-character IFSC, for example HDFC0001234. You can find it on your cheque book or bank app.'
export const UPI_MESSAGE = 'Enter a UPI ID like name@bank.'

function normalizeName(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

const holderName = z.string().transform(normalizeName).pipe(
  z.string().min(3, HOLDER_NAME_MESSAGE).max(100, HOLDER_NAME_MESSAGE).regex(/^[A-Za-z]+(?: [A-Za-z]+)*$/, HOLDER_NAME_MESSAGE),
)

export const payoutAccountInputSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('bank'),
    holderName,
    accountNumber: z.string().transform((value) => value.replace(/[\s-]/g, '')).pipe(z.string().regex(/^[0-9]{9,18}$/, ACCOUNT_NUMBER_MESSAGE)),
    confirmAccountNumber: z.string().transform((value) => value.replace(/[\s-]/g, '')),
    ifsc: z.string().transform((value) => value.replace(/\s/g, '').toUpperCase()).pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, IFSC_MESSAGE)),
  }).superRefine((value, context) => {
    if (value.accountNumber !== value.confirmAccountNumber) {
      context.addIssue({ code: 'custom', path: ['confirmAccountNumber'], message: ACCOUNT_CONFIRM_MESSAGE })
    }
  }),
  z.object({
    method: z.literal('upi'),
    holderName,
    vpa: z.string().transform((value) => value.trim().toLowerCase()).pipe(
      z.string().max(100, UPI_MESSAGE).regex(/^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9.-]{1,63}$/, UPI_MESSAGE),
    ),
  }),
])

export type PayoutAccountInput = z.infer<typeof payoutAccountInputSchema>
export type PayoutAccountFieldErrors = Partial<Record<'method' | 'holderName' | 'accountNumber' | 'confirmAccountNumber' | 'ifsc' | 'vpa', string>>

/** Field errors for the payout details form, or the parsed input. */
export function parsePayoutAccountInput(raw: unknown): { ok: true; input: PayoutAccountInput } | { ok: false; fieldErrors: PayoutAccountFieldErrors } {
  const parsed = payoutAccountInputSchema.safeParse(raw)
  if (parsed.success) return { ok: true, input: parsed.data }
  const fieldErrors: PayoutAccountFieldErrors = {}
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? 'method') as keyof PayoutAccountFieldErrors
    if (!fieldErrors[key]) fieldErrors[key] = key === 'method' ? 'Choose bank account or UPI ID.' : issue.message
  }
  return { ok: false, fieldErrors }
}

export function accountLast4(accountNumber: string) {
  return accountNumber.slice(-4)
}

/** "ra•••@okhdfc": first two characters of the handle, then the bank handle. */
export function maskVpa(vpa: string) {
  const [handle, bank] = vpa.split('@')
  if (!bank) return '•••'
  return `${handle.slice(0, 2)}•••@${bank}`
}

export type MaskedPayoutAccount = {
  method: PayoutMethod
  holderName: string
  /** e.g. "Bank account ••••1772 · HDFC0000001" or "UPI ra•••@okhdfc" */
  summary: string
  ifsc: string | null
  last4: string | null
  maskedVpa: string | null
}

export function maskPayoutAccount(account: { method: PayoutMethod; holderName: string; ifsc: string | null; last4: string | null; vpa: string | null }): MaskedPayoutAccount {
  if (account.method === 'upi') {
    const masked = account.vpa ? maskVpa(account.vpa) : '•••'
    return { method: 'upi', holderName: account.holderName, summary: `UPI ${masked}`, ifsc: null, last4: null, maskedVpa: masked }
  }
  return {
    method: 'bank',
    holderName: account.holderName,
    summary: `Bank account ••••${account.last4 ?? '????'} · ${account.ifsc ?? ''}`.trim(),
    ifsc: account.ifsc,
    last4: account.last4,
    maskedVpa: null,
  }
}

// ---------------------------------------------------------------------------
// Transfer statuses (cashfree-api.txt §3.4)
// ---------------------------------------------------------------------------

export type TransferOutcome = 'success' | 'processing' | 'failed' | 'reversed'

/**
 * Cashfree transfer status -> our payout outcome. Anything unknown is "processing":
 * money is only released back to the seller on a definite failure.
 */
export function transferOutcome(status: string | null | undefined): TransferOutcome {
  const value = (status ?? '').trim().toUpperCase()
  if (value === 'SUCCESS' || value === 'COMPLETED' || value === 'SENT_TO_BENEFICIARY') return 'success'
  if (value === 'FAILED' || value === 'REJECTED' || value === 'MANUALLY_REJECTED') return 'failed'
  if (value === 'REVERSED') return 'reversed'
  return 'processing'
}

/** Which payout status changes are allowed. Terminal states never move again, except success -> reversed. */
export function nextPayoutStatus(current: PayoutStatus, outcome: TransferOutcome): PayoutStatus | null {
  if (current === 'draft' || current === 'processing') {
    return outcome === 'reversed' ? 'reversed' : outcome === 'processing' ? 'processing' : outcome
  }
  if (current === 'success' && outcome === 'reversed') return 'reversed'
  return null
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Not sent yet', tone: 'warning' },
  processing: { label: 'On its way', tone: 'info' },
  success: { label: 'Paid', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  reversed: { label: 'Returned by bank', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

export const EARNING_STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'On hold', tone: 'neutral' },
  available: { label: 'Ready for payout', tone: 'info' },
  in_payout: { label: 'In a payout', tone: 'warning' },
  paid: { label: 'Paid out', tone: 'success' },
  reversed: { label: 'Refunded', tone: 'danger' },
}

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  event_ticket: 'Event ticket',
  course_purchase: 'Course purchase',
  adjustment: 'Refund after payout',
}

/** Rupees with the ₹ sign and always 2 decimals, e.g. "₹1,499.00" — for money-exact screens. */
export function formatExactMoney(amountMinor: number, currency = 'INR') {
  const code = currency === 'USD' ? 'USD' : 'INR'
  const negative = amountMinor < 0
  const absolute = Math.abs(amountMinor)
  const text = new Intl.NumberFormat(code === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.floor(absolute / 100) + (absolute % 100) / 100)
  return negative ? `−${text}` : text
}

export { formatMoney }

/** "12.50" -> "12.5%", "10.00" -> "10%". */
export function formatPercentLabel(percent: string) {
  const value = Number(percent)
  if (!Number.isFinite(value)) return `${percent}%`
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0$/, '')}%`
}

/** Parse the rupee amount an admin typed ("100", "100.50", "1,000") into paise. */
export function parseRupeesToMinor(value: string): number | null {
  const normalized = value.trim().replace(/[,\s₹]/g, '')
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(normalized)) return null
  const [whole, fraction = ''] = normalized.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

export function minorToRupeesInput(amountMinor: number) {
  const whole = Math.floor(amountMinor / 100)
  const fraction = amountMinor % 100
  return fraction ? `${whole}.${String(fraction).padStart(2, '0')}` : String(whole)
}

export const PAYOUTS_NOT_CONFIGURED_MESSAGE = 'Payouts are not switched on for Sea N Shore yet. Your earnings are safe and keep adding up; you can add payout details as soon as payouts open.'
