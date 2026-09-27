/**
 * Shapes and copy shared by the billing server actions and the browser checkout.
 * Safe to import from client components.
 */

export type PlanCheckoutTarget = { kind: 'personal' } | { kind: 'organization'; companyId: string }

export type StartPlanCheckoutResult =
  | {
      ok: true
      checkoutId: string
      subscriptionSessionId: string
      mode: 'sandbox' | 'production'
    }
  | {
      ok: false
      error: string
      /** Ask for these, then call again with them. */
      needsContact?: { phone: boolean; email: boolean }
    }

/** What the page shows while / after the customer approves the mandate. */
export type PlanCheckoutState = 'waiting' | 'pending_approval' | 'active' | 'failed' | 'closed' | 'unknown'

export type CheckPlanCheckoutResult = { state: PlanCheckoutState; title: string; message: string }

export type CancelAutoRenewResult = { ok: true; message: string } | { ok: false; error: string }

export const BILLING_NOT_CONFIGURED_TITLE = 'Online payment isn’t set up yet'
export const BILLING_NOT_CONFIGURED_MESSAGE = 'Sea N Shore is finishing its payment setup. Nothing can be charged until it is ready. To get the plan sooner, contact the Sea N Shore team.'
export const CONTACT_REQUIRED_MESSAGE = 'Our payment partner needs your mobile number and email address to set up auto-renew and send you payment notices.'
export const EMAIL_INVALID_MESSAGE = 'Enter a valid email address, for example name@example.com.'

export function checkoutStateCopy(state: PlanCheckoutState, context: { planLabel: string; renewsOn?: string | null }): CheckPlanCheckoutResult {
  switch (state) {
    case 'active':
      return {
        state,
        title: `${context.planLabel} is active`,
        message: context.renewsOn
          ? `Auto-renew is on. The next payment is taken on ${context.renewsOn}.`
          : 'Auto-renew is on. You can use your new plan right away.',
      }
    case 'pending_approval':
      return {
        state,
        title: 'Waiting for your bank to approve',
        message: `Your bank is reviewing the auto-pay mandate. This usually takes a few minutes and can take up to 2 working days for bank account mandates. ${context.planLabel} switches on as soon as it is approved — you don’t need to do anything else.`,
      }
    case 'failed':
      return {
        state,
        title: 'Auto-pay wasn’t set up',
        message: 'The mandate was not approved, so no money was taken. You can try again, or use a different UPI app, card or bank account.',
      }
    case 'closed':
      return {
        state,
        title: 'This setup was closed',
        message: 'This auto-pay setup was cancelled before it started. No money was taken. Start again whenever you are ready.',
      }
    case 'waiting':
      return {
        state,
        title: 'Finish approving auto-pay',
        message: 'Complete the approval in the Cashfree window (it may have opened in a new tab). This page updates on its own once you’re done.',
      }
    default:
      return {
        state: 'unknown',
        title: 'We couldn’t check the status yet',
        message: 'Our payment partner didn’t answer just now. If you approved the mandate, your plan switches on automatically within a few minutes. Refresh this page to check.',
      }
  }
}
