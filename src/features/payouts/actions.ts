'use server'

import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { sellerPayoutErrorMessage } from './payout-messages'
import { PayoutError } from './payout-repository'
import { maskPayoutAccount, parsePayoutAccountInput, parseSellerKey, type MaskedPayoutAccount, type PayoutAccountFieldErrors } from './payout-rules'
import { payoutService } from './payout-runtime'
import { PayoutProviderError, PayoutsNotConfiguredError } from './payout-service'

export type SavePayoutAccountResult =
  | { ok: true; message: string; account: MaskedPayoutAccount }
  | { ok: false; error: string; fieldErrors?: PayoutAccountFieldErrors }

export type RemovePayoutAccountResult = { ok: true; message: string } | { ok: false; error: string }

function refresh() {
  for (const path of ['/settings/payouts', '/settings/earnings', '/admin/payments/payouts']) revalidatePath(path)
}

function logUnexpected(event: string, error: unknown) {
  if (error instanceof PayoutError || error instanceof PayoutProviderError || error instanceof PayoutsNotConfiguredError) return
  // Never log the submitted details: only the error name.
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
