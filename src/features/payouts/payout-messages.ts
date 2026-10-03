import { PayoutError } from './payout-repository'
import { formatExactMoney } from './payout-rules'
import { PayoutProviderError, PayoutsNotConfiguredError, type PayoutOutcome } from './payout-service'

/** Plain-language messages for payout results and failures (seller and admin screens). */

export function sellerPayoutErrorMessage(error: unknown) {
  if (error instanceof PayoutsNotConfiguredError) return 'Payouts are not switched on yet, so payout details cannot be saved. Nothing was saved.'
  if (error instanceof PayoutError) {
    if (error.code === 'forbidden') return 'You can only manage payout details for yourself or for an organization you own or administer.'
    if (error.code === 'payout_in_progress') return 'A payout to your current details is on its way. You can change or remove them once it completes.'
  }
  if (error instanceof PayoutProviderError) {
    if (error.reason === 'details_rejected') return "Cashfree couldn't accept these payout details. Check the account number and IFSC, or the UPI ID, and try again. Nothing was saved."
    if (error.reason === 'duplicate_details') return 'These bank details are already registered with our payout partner under another record. Use different details, or contact the Sea N Shore team.'
    if (error.reason === 'setup') return "Payout details can't be saved right now because of a setup problem on our side. Nothing was saved. Please try again later."
    return "We couldn't reach our payout partner, Cashfree. Nothing was saved. Please try again in a few minutes."
  }
  return "We couldn't save your payout details. Nothing was changed. Please try again."
}

export function adminPayoutErrorMessage(error: unknown, context: { minPayoutMinor?: number } = {}) {
  if (error instanceof PayoutsNotConfiguredError) return 'Cashfree Payouts is not set up yet, so nothing can be sent. Add the Payouts API keys to the Cashfree secret first.'
  if (error instanceof PayoutError) {
    switch (error.code) {
      case 'forbidden': return 'Only Sea N Shore platform administrators can manage payouts.'
      case 'no_payout_account': return "This seller hasn't added payout details yet. Nothing was sent. Ask them to add a bank account or UPI ID under Settings → Payout details."
      case 'payout_in_progress': return 'This payout was handed to Cashfree less than 2 minutes ago. Wait a moment, then select Check status.'
      case 'nothing_to_pay': return 'There is nothing to pay: refunds after earlier payouts cancel out this seller\'s new earnings. Nothing was sent.'
      case 'below_minimum': return `The balance is below the minimum payout${context.minPayoutMinor ? ` of ${formatExactMoney(context.minPayoutMinor)}` : ''}. Nothing was sent; it will be payable once it reaches the minimum.`
      case 'balance_changed': return 'The balance changed after you opened this review (a new sale became available or a refund came in). Nothing was sent. Check the updated amount and send again.'
      case 'payout_not_found': return "We couldn't find this payout. Refresh the page."
      case 'payout_not_cancellable': return 'Only a payout that Cashfree never received can be cancelled. Check its status instead.'
      case 'account_not_found': return "The payout details for this payout are missing. Nothing was sent. Contact the engineering team."
    }
  }
  if (error instanceof PayoutProviderError) {
    if (error.reason === 'setup') return 'Cashfree refused the request because the Payouts setup is incomplete (API keys, IP whitelist or 2FA public key). Nothing was changed. Check the Cashfree Payouts settings.'
    return "We couldn't reach Cashfree. Nothing was changed. Try again in a few minutes."
  }
  return 'Something went wrong on our side. Nothing was changed. Refresh the page and check the payout status before trying again.'
}

export function payoutOutcomeMessage(outcome: PayoutOutcome, sellerName: string) {
  const amount = formatExactMoney(outcome.payout.amountMinor)
  switch (outcome.state) {
    case 'success':
      return `${amount} was paid to ${sellerName}.${outcome.payout.utr ? ` Bank reference (UTR): ${outcome.payout.utr}.` : ''}`
    case 'processing':
      return `${amount} is on its way to ${sellerName}. Cashfree accepted the transfer; banks usually complete it within minutes, sometimes by the next working day. This page updates when Cashfree confirms.`
    case 'failed':
      return `The transfer of ${amount} to ${sellerName} did not go through${outcome.payout.failureReason ? ` (${outcome.payout.failureReason.replace(/\.$/, '')})` : ''}. The earnings are back in their available balance, so you can send a new payout once the problem is fixed.`
    case 'reversed':
      return `The bank returned the ${amount} sent to ${sellerName}. The earnings are back in their available balance. Ask them to check their payout details before you pay again.`
    case 'cancelled':
      return `Payout cancelled. No money was sent, and the ${amount} is back in ${sellerName}'s available balance.`
    case 'sending':
      return 'This payout is already being sent. Wait a moment, then select Check status.'
    case 'not_at_cashfree':
      return `Cashfree has no record of this transfer, so no money was sent. You can send the ${amount} again or cancel the payout to return it to ${sellerName}'s balance.`
    case 'unconfirmed':
    default:
      return `Cashfree did not confirm the transfer of ${amount} yet. The earnings stay reserved for this payout. Select Check status in a minute to see whether Cashfree received it.`
  }
}
