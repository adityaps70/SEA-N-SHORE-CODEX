import { randomUUID } from 'node:crypto'
import type { DatabaseQueryClient } from '@/lib/db/client'
import type { CashfreePayoutsConfig } from '@/features/payments/cashfree-config'
import type { Seller } from '@/features/payments/earnings'
import { PaymentProviderError } from '@/features/payments/types'
import { createCashfreePayoutsClient, isDefiniteRejection, type CashfreeBeneficiary, type CashfreePayoutsClient } from './cashfree-payouts-client'
import {
  applyTransferReport,
  beneficiaryStillInUse,
  canManageSeller,
  cancelDraftPayout,
  claimDispatch,
  createPayout,
  findActiveBeneficiaryForVpa,
  getPayout,
  getPayoutAccountById,
  getPayoutSettings,
  hasOpenPayout,
  markPayoutChecked,
  noteDispatchProblem,
  PayoutError,
  removeActivePayoutAccount,
  saveActivePayoutAccount,
  type Payout,
  type PayoutAccount,
  type PayoutActor,
} from './payout-repository'
import { accountLast4, beneficiaryIdFor, DISPATCH_RETRY_AFTER_MS, type PayoutAccountInput } from './payout-rules'

/**
 * Seller payouts: payout details (Cashfree beneficiaries) and admin-approved transfers.
 * Rules:
 * - Cashfree is called outside database transactions; every state change it causes is
 *   written afterwards in a transaction (payout-repository.ts), with an audit trail.
 * - One transfer_id per payout, derived from the payout id. A send whose answer was
 *   unclear (timeout / 5xx) is never repeated blindly: we ask Cashfree for that
 *   transfer_id first, and only send again (same id) when Cashfree has no record.
 * - Earnings are released back to the seller only on a definite failure.
 */

export class PayoutsNotConfiguredError extends Error {
  constructor() {
    super('payouts_not_configured')
    this.name = 'PayoutsNotConfiguredError'
  }
}

/** Cashfree could not be used for this request. `reason` picks the message shown. */
export class PayoutProviderError extends Error {
  constructor(readonly reason: 'unavailable' | 'setup' | 'details_rejected' | 'duplicate_details', readonly providerMessage: string | null = null) {
    super(`payout_provider_${reason}`)
    this.name = 'PayoutProviderError'
  }
}

export type PayoutSendState =
  | 'success'
  | 'processing'
  | 'failed'
  | 'reversed'
  | 'cancelled'
  /** Cashfree did not answer clearly. Nothing is released; check the status. */
  | 'unconfirmed'
  /** Another send of this payout started moments ago (double click). */
  | 'sending'
  /** Cashfree has no transfer with this id (only possible for a draft). */
  | 'not_at_cashfree'

export type PayoutOutcome = { state: PayoutSendState; payout: Payout; alreadyOpen?: boolean }

type Transaction = <T>(work: (tx: DatabaseQueryClient) => Promise<T>) => Promise<T>

export type PayoutServiceDeps = {
  transaction: Transaction
  read: DatabaseQueryClient
  loadConfig: () => Promise<CashfreePayoutsConfig | null>
  createClient?: (config: CashfreePayoutsConfig) => CashfreePayoutsClient
  now?: () => Date
  newId?: () => string
  log?: (message: string, details?: Record<string, unknown>) => void
}

function stateOf(payout: Payout): PayoutSendState {
  return payout.status === 'draft' ? 'unconfirmed' : payout.status
}

function providerFailure(error: unknown): PayoutProviderError {
  if (error instanceof PaymentProviderError) {
    if (error.status === 401 || error.status === 403) return new PayoutProviderError('setup', error.providerMessage)
    if (error.status === 400 || error.status === 422) return new PayoutProviderError('details_rejected', error.providerMessage)
  }
  return new PayoutProviderError('unavailable')
}

/** Plain reason for a transfer Cashfree refused outright. */
function rejectionReason(error: unknown) {
  const message = error instanceof PaymentProviderError ? error.providerMessage : null
  return message ? `Cashfree refused the transfer: ${message}`.slice(0, 500) : 'Cashfree refused the transfer'
}

export function createPayoutService(deps: PayoutServiceDeps) {
  const now = deps.now ?? (() => new Date())
  const newId = deps.newId ?? randomUUID
  const log = deps.log ?? ((message, details) => console.error(message, details ?? {}))
  const makeClient = deps.createClient ?? ((config: CashfreePayoutsConfig) => createCashfreePayoutsClient(config))

  async function requireClient() {
    const config = await deps.loadConfig()
    if (!config) throw new PayoutsNotConfiguredError()
    return makeClient(config)
  }

  async function removeBeneficiaryQuietly(client: CashfreePayoutsClient, beneficiaryId: string, context: string) {
    try {
      if (await beneficiaryStillInUse(deps.read, beneficiaryId, null)) return
      await client.removeBeneficiary(beneficiaryId)
    } catch (error) {
      // Only ids and status codes are logged; never account details or keys.
      log('payout_beneficiary_cleanup_failed', { context, status: error instanceof PaymentProviderError ? error.status : null })
    }
  }

  async function registerBeneficiary(client: CashfreePayoutsClient, input: PayoutAccountInput, beneficiaryId: string): Promise<{ beneficiary: CashfreeBeneficiary; reused: boolean }> {
    try {
      const beneficiary = await client.createBeneficiary(input.method === 'bank'
        ? { beneficiaryId, name: input.holderName, bankAccountNumber: input.accountNumber, bankIfsc: input.ifsc }
        : { beneficiaryId, name: input.holderName, vpa: input.vpa })
      return { beneficiary, reused: false }
    } catch (error) {
      if (!(error instanceof PaymentProviderError) || error.status !== 409) throw providerFailure(error)
    }
    // 409: Cashfree already has these details (e.g. the member and their organization use one account).
    if (input.method === 'bank') {
      let existing: CashfreeBeneficiary | null
      try {
        existing = await client.findBeneficiaryByBankAccount(input.accountNumber, input.ifsc)
      } catch (error) {
        throw providerFailure(error)
      }
      if (existing && !['DELETED', 'INVALID', 'FAILED', 'CANCELLED'].includes(String(existing.status))) return { beneficiary: existing, reused: true }
    } else {
      const known = await findActiveBeneficiaryForVpa(deps.read, input.vpa)
      if (known) return { beneficiary: { beneficiaryId: known, status: null, bankAccountLast4: null, bankIfsc: null, vpa: input.vpa }, reused: true }
    }
    throw new PayoutProviderError('duplicate_details')
  }

  /**
   * Saves payout details for a seller: straight to Cashfree as a beneficiary, then the
   * masked record here. Replaces the seller's current details.
   */
  async function addPayoutAccount(input: { actorProfileId: string; seller: Seller; details: PayoutAccountInput }): Promise<{ account: PayoutAccount; replaced: boolean }> {
    if (!await canManageSeller(deps.read, input.actorProfileId, input.seller)) throw new PayoutError('forbidden')
    const client = await requireClient()
    if (await hasOpenPayout(deps.read, input.seller)) throw new PayoutError('payout_in_progress')

    const accountId = newId()
    const { beneficiary, reused } = await registerBeneficiary(client, input.details, beneficiaryIdFor(accountId))
    if (beneficiary.status === 'INVALID' || beneficiary.status === 'FAILED') {
      if (!reused) await removeBeneficiaryQuietly(client, beneficiary.beneficiaryId, 'rejected')
      throw new PayoutProviderError('details_rejected')
    }

    let saved: Awaited<ReturnType<typeof saveActivePayoutAccount>>
    try {
      saved = await deps.transaction((tx) => saveActivePayoutAccount(tx, {
        accountId,
        seller: input.seller,
        method: input.details.method,
        holderName: input.details.holderName,
        ifsc: input.details.method === 'bank' ? input.details.ifsc : null,
        last4: input.details.method === 'bank' ? accountLast4(input.details.accountNumber) : null,
        vpa: input.details.method === 'upi' ? input.details.vpa : null,
        beneficiaryId: beneficiary.beneficiaryId,
        providerStatus: beneficiary.status,
        providerVerified: beneficiary.status === 'VERIFIED',
        actorProfileId: input.actorProfileId,
      }))
    } catch (error) {
      if (!reused) await removeBeneficiaryQuietly(client, beneficiary.beneficiaryId, 'save_failed')
      throw error
    }
    if (saved.replaced && saved.replaced.providerBeneficiaryId !== beneficiary.beneficiaryId) {
      await removeBeneficiaryQuietly(client, saved.replaced.providerBeneficiaryId, 'replaced')
    }
    return { account: saved.account, replaced: Boolean(saved.replaced) }
  }

  async function removePayoutAccount(input: { actorProfileId: string; seller: Seller }) {
    if (!await canManageSeller(deps.read, input.actorProfileId, input.seller)) throw new PayoutError('forbidden')
    const removed = await deps.transaction((tx) => removeActivePayoutAccount(tx, input))
    if (!removed) return { removed: null }
    const config = await deps.loadConfig()
    if (config) await removeBeneficiaryQuietly(makeClient(config), removed.providerBeneficiaryId, 'removed')
    return { removed }
  }

  /** Sends a claimed draft to Cashfree and records the answer. */
  async function dispatch(client: CashfreePayoutsClient, payout: Payout, actor: PayoutActor, source: 'send' | 'retry'): Promise<PayoutOutcome> {
    const account = await getPayoutAccountById(deps.read, payout.payoutAccountId)
    if (!account) throw new PayoutError('account_not_found')
    let transfer
    try {
      transfer = await client.createTransfer({
        transferId: payout.transferId,
        amountMinor: payout.amountMinor,
        beneficiaryId: account.providerBeneficiaryId,
        mode: payout.transferMode === 'upi' ? 'upi' : 'banktransfer',
      })
    } catch (error) {
      if (isDefiniteRejection(error)) {
        const applied = await deps.transaction((tx) => applyTransferReport(tx, {
          payoutId: payout.id,
          report: { status: 'FAILED', statusDescription: rejectionReason(error) },
          actor,
          source,
        }))
        return { state: 'failed', payout: applied?.payout ?? payout }
      }
      log('payout_transfer_unconfirmed', { payoutId: payout.id, status: error instanceof PaymentProviderError ? error.status : null })
      const noted = await deps.transaction((tx) => noteDispatchProblem(tx, {
        payoutId: payout.id,
        note: 'Cashfree did not confirm this transfer. Check its status before doing anything else.',
        actor,
      }))
      return { state: 'unconfirmed', payout: noted ?? payout }
    }
    const report = transfer
    const applied = await deps.transaction((tx) => applyTransferReport(tx, { payoutId: payout.id, report, actor, source }))
    const current = applied?.payout ?? payout
    if (applied && !applied.changed && applied.reason === 'amount_mismatch') {
      log('payout_transfer_amount_mismatch', { payoutId: payout.id })
      return { state: 'unconfirmed', payout: current }
    }
    return { state: stateOf(current), payout: current }
  }

  /** Re-sends a draft (same transfer_id) only after Cashfree confirms it has no such transfer. */
  async function resendDraft(client: CashfreePayoutsClient, payout: Payout, actor: PayoutActor): Promise<PayoutOutcome> {
    let existing
    try {
      existing = await client.getTransfer(payout.transferId)
    } catch (error) {
      throw providerFailure(error)
    }
    if (existing) {
      const applied = await deps.transaction((tx) => applyTransferReport(tx, { payoutId: payout.id, report: existing, actor, source: 'retry' }))
      const current = applied?.payout ?? payout
      return { state: stateOf(current), payout: current }
    }
    const claimed = await deps.transaction((tx) => claimDispatch(tx, payout.id, now()))
    if (!claimed) {
      const current = await getPayout(deps.read, payout.id) ?? payout
      return { state: current.status === 'draft' ? 'sending' : stateOf(current), payout: current }
    }
    return dispatch(client, claimed, actor, 'retry')
  }

  /**
   * Admin: "Send ₹X via Cashfree" for the reviewed earnings. Creates the payout and moves
   * the earnings in one transaction, then calls Cashfree. A second click returns the
   * payout that is already open instead of creating another.
   */
  async function sendPayout(input: { actorProfileId: string; seller: Seller; earningIds: string[]; expectedTotalMinor: number }): Promise<PayoutOutcome> {
    const client = await requireClient()
    const actor: PayoutActor = { type: 'admin', profileId: input.actorProfileId }
    const settings = await getPayoutSettings(deps.read)
    const created = await deps.transaction((tx) => createPayout(tx, {
      payoutId: newId(),
      seller: input.seller,
      earningIds: input.earningIds,
      expectedTotalMinor: input.expectedTotalMinor,
      minPayoutMinor: settings.minPayoutMinor,
      actorProfileId: input.actorProfileId,
      now: now(),
    }))
    if (created.kind === 'existing') {
      const payout = created.payout
      if (payout.status !== 'draft') return { state: stateOf(payout), payout, alreadyOpen: true }
      const outcome = await resendDraft(client, payout, actor)
      return { ...outcome, alreadyOpen: true }
    }
    return dispatch(client, created.payout, actor, 'send')
  }

  /** Admin: ask Cashfree for the transfer status now ("Refresh status"). */
  async function refreshPayoutStatus(input: { actorProfileId: string; payoutId: string }): Promise<PayoutOutcome> {
    const payout = await getPayout(deps.read, input.payoutId)
    if (!payout) throw new PayoutError('payout_not_found')
    const client = await requireClient()
    let transfer
    try {
      transfer = await client.getTransfer(payout.transferId)
    } catch (error) {
      throw providerFailure(error)
    }
    if (!transfer) {
      await deps.transaction((tx) => markPayoutChecked(tx, payout.id))
      return { state: payout.status === 'draft' ? 'not_at_cashfree' : stateOf(payout), payout }
    }
    const applied = await deps.transaction((tx) => applyTransferReport(tx, {
      payoutId: payout.id,
      report: transfer,
      actor: { type: 'admin', profileId: input.actorProfileId },
      source: 'refresh',
    }))
    const current = applied?.payout ?? payout
    return { state: stateOf(current), payout: current }
  }

  /** Admin: send a draft again after Cashfree confirmed it never received it. */
  async function retryPayout(input: { actorProfileId: string; payoutId: string }): Promise<PayoutOutcome> {
    const payout = await getPayout(deps.read, input.payoutId)
    if (!payout) throw new PayoutError('payout_not_found')
    if (payout.status !== 'draft') return { state: stateOf(payout), payout }
    const client = await requireClient()
    return resendDraft(client, payout, { type: 'admin', profileId: input.actorProfileId })
  }

  /** Admin: cancel a draft that Cashfree has no record of; its earnings become available again. */
  async function cancelPayout(input: { actorProfileId: string; payoutId: string }): Promise<PayoutOutcome> {
    const payout = await getPayout(deps.read, input.payoutId)
    if (!payout) throw new PayoutError('payout_not_found')
    if (payout.status === 'cancelled') return { state: 'cancelled', payout }
    if (payout.status !== 'draft') throw new PayoutError('payout_not_cancellable')
    if (payout.lastDispatchAt && now().getTime() - Date.parse(payout.lastDispatchAt) < DISPATCH_RETRY_AFTER_MS) {
      throw new PayoutError('payout_in_progress')
    }
    const client = await requireClient()
    let transfer
    try {
      transfer = await client.getTransfer(payout.transferId)
    } catch (error) {
      throw providerFailure(error)
    }
    if (transfer) {
      // Cashfree has it after all: follow Cashfree, do not cancel.
      const applied = await deps.transaction((tx) => applyTransferReport(tx, {
        payoutId: payout.id,
        report: transfer,
        actor: { type: 'admin', profileId: input.actorProfileId },
        source: 'refresh',
      }))
      const current = applied?.payout ?? payout
      return { state: stateOf(current), payout: current }
    }
    const cancelled = await deps.transaction((tx) => cancelDraftPayout(tx, {
      payoutId: payout.id,
      actorProfileId: input.actorProfileId,
      reason: 'Cancelled by an administrator; Cashfree had no record of this transfer',
    }))
    return { state: 'cancelled', payout: cancelled }
  }

  return { addPayoutAccount, removePayoutAccount, sendPayout, refreshPayoutStatus, retryPayout, cancelPayout }
}

export type PayoutService = ReturnType<typeof createPayoutService>
