'use server'

import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { describeIfsc, IFSC_NOT_FOUND_MESSAGE, IFSC_PATTERN, lookupIfsc } from './ifsc-lookup'
import { sellerPayoutErrorMessage } from './payout-messages'
import { PayoutError } from './payout-repository'
import { maskPayoutAccount, parsePayoutAccountInput, parseSellerKey, type MaskedPayoutAccount, type PayoutAccountFieldErrors } from './payout-rules'
import { payoutService } from './payout-runtime'
import { PayoutProviderError, PayoutsNotConfiguredError } from './payout-service'

export type SavePayoutAccountResult =
  | { ok: true; message: string; account: MaskedPayoutAccount }
  | { ok: false; error: string; fieldErrors?: PayoutAccountFieldErrors }

export type RemovePayoutAccountResult = { ok: true; message: string } | { ok: false; error: string }

export type IfscLookupResult = { ok: true; bank: string | null; found: boolean } | { ok: false; error: string }

function refresh() {
  for (const path of ['/settings/payouts', '/settings/earnings', '/admin/payments/payouts']) revalidatePath(path)
}

function logUnexpected(event: string, error: unknown) {
  if (error instanceof PayoutError) return
  // Never log the submitted details or Cashfree's text: only a reason code and the HTTP status.
  if (error instanceof PayoutsNotConfiguredError) {
    console.error(event, { kind: 'setup', reason: 'payouts_not_configured' })
    return
  }
  if (error instanceof PayoutProviderError) {
    if (error.reason === 'setup') console.error(event, { kind: 'setup', reason: error.setupReason, status: error.status })
    else if (error.reason === 'unavailable') console.error(event, { kind: 'unavailable', status: error.status })
    else console.warn(event, { kind: 'rejected', reason: error.reason, status: error.status })
    return
  }
  console.error(event, { name: error instanceof Error ? error.name : null })
}

/**
 * Saves bank or UPI payout details for the signed-in member or an organization they
 * own/administer. The details go to Cashfree; only masked data is stored here.
 */
export async function savePayoutAccountAction(sellerKeyValue: string, details: Record<string, unknown>): Promise<SavePayoutAccountResult> {
  const seller = parseSellerKey(sellerKeyValue)
  if (!seller) return { ok: false, error: 'Choose whose payout details these are, then try again.' }
  const parsed = parsePayoutAccountInput({
    method: details.method,
    holderName: String(details.holderName ?? ''),
    accountNumber: String(details.accountNumber ?? ''),
    confirmAccountNumber: String(details.confirmAccountNumber ?? ''),
    ifsc: String(details.ifsc ?? ''),
    vpa: String(details.vpa ?? ''),
  })
  if (!parsed.ok) return { ok: false, error: 'Check the highlighted fields.', fieldErrors: parsed.fieldErrors }
  try {
    const user = await requireAwsUser()
    // An IFSC that definitely does not exist is a mistake in the form, not something to send to Cashfree.
    if (parsed.input.method === 'bank' && (await lookupIfsc(parsed.input.ifsc)).status === 'not_found') {
      return { ok: false, error: 'Check the highlighted fields.', fieldErrors: { ifsc: IFSC_NOT_FOUND_MESSAGE } }
    }
    const { account, replaced } = await payoutService.addPayoutAccount({ actorProfileId: user.id, seller, details: parsed.input })
    refresh()
    const masked = maskPayoutAccount(account)
    return {
      ok: true,
      account: masked,
      message: replaced
        ? `Payout details updated. Future payouts go to ${masked.summary}.`
        : `Payout details saved. Payouts will go to ${masked.summary}.`,
    }
  } catch (error) {
    logUnexpected('payout_account_save_failed', error)
    return { ok: false, error: sellerPayoutErrorMessage(error) }
  }
}

/** The bank (and branch) for an IFSC, for the line under the IFSC field. Signed-in members only. */
export async function lookupIfscAction(ifscValue: string): Promise<IfscLookupResult> {
  const ifsc = String(ifscValue ?? '').replace(/\s/g, '').toUpperCase()
  if (!IFSC_PATTERN.test(ifsc)) return { ok: false, error: 'Enter the 11-character IFSC.' }
  try {
    await requireAwsUser()
    const result = await lookupIfsc(ifsc)
    if (result.status === 'not_found') return { ok: true, bank: null, found: false }
    return { ok: true, bank: describeIfsc(result), found: true }
  } catch (error) {
    logUnexpected('payout_ifsc_lookup_failed', error)
    return { ok: false, error: "We couldn't look up this IFSC right now." }
  }
}

export async function removePayoutAccountAction(sellerKeyValue: string): Promise<RemovePayoutAccountResult> {
  const seller = parseSellerKey(sellerKeyValue)
  if (!seller) return { ok: false, error: 'Choose whose payout details to remove, then try again.' }
  try {
    const user = await requireAwsUser()
    const { removed } = await payoutService.removePayoutAccount({ actorProfileId: user.id, seller })
    refresh()
    return { ok: true, message: removed ? 'Payout details removed. Add new details to receive payouts again.' : 'There were no payout details to remove.' }
  } catch (error) {
    logUnexpected('payout_account_remove_failed', error)
    return { ok: false, error: error instanceof PayoutError || error instanceof PayoutProviderError ? sellerPayoutErrorMessage(error) : "We couldn't remove your payout details. Nothing was changed. Please try again." }
  }
}
