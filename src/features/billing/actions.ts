'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { PHONE_INVALID_MESSAGE, PHONE_REJECTED_MESSAGE } from '@/features/payments/checkout-types'
import { canBuyCreatorPro, canManageOrganizationBilling, organizationIsVerified } from './billing-access'
import { formatBillingDate } from './billing-view'
import {
  AUTOPAY_UNAVAILABLE_MESSAGE,
  BILLING_NOT_CONFIGURED_MESSAGE,
  CONTACT_REQUIRED_MESSAGE,
  EMAIL_INVALID_MESSAGE,
  checkoutStateCopy,
  type CancelAutoRenewResult,
  type CheckPlanCheckoutResult,
  type PlanCheckoutState,
  type PlanCheckoutTarget,
  type StartPlanCheckoutResult,
} from './checkout-messages'
import { BILLING_INTERVALS, PLAN_LABELS, TRIAL_MONTHS, type BillingInterval, type BillingSubject } from './plans'
import { trialService } from './trial-service'
import { TrialNotAvailableError } from './trials'
import { billingRepository } from './repository'
import { subscriptionRepository } from './subscription-repository'
import {
  AlreadySubscribedError,
  BillingGatewayError,
  BillingNotConfiguredError,
  billingPaths,
  ContactDetailsRequiredError,
  NothingToCancelError,
  PlanPriceUnavailableError,
  subscriptionService,
} from './subscription-service'
import type { CheckoutRecord } from './subscription-types'

const targetSchema = z.union([
  z.object({ kind: z.literal('personal') }),
  z.object({ kind: z.literal('organization'), companyId: z.string().uuid() }),
])

const startSchema = z.object({
  target: targetSchema,
  interval: z.enum(BILLING_INTERVALS),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().max(120).optional(),
})

type Authorized = { user: Awaited<ReturnType<typeof requireAwsUser>>; subject: BillingSubject; label: string | null }

class BillingForbiddenError extends Error {
  constructor(readonly userMessage: string) {
    super('billing_forbidden')
    this.name = 'BillingForbiddenError'
  }
}

/** Server-side authorization for every billing action: never trust the page. */
async function authorize(target: PlanCheckoutTarget, purpose: 'buy' | 'manage'): Promise<Authorized> {
  const user = await requireAwsUser()
  const access = await getAccessContext(user.id)
  if (target.kind === 'personal') {
    if (!canBuyCreatorPro(access)) throw new BillingForbiddenError('Your account can’t change plans right now. Contact the Sea N Shore team for help.')
    return { user, subject: { kind: 'profile', profileId: user.id }, label: null }
  }
  if (!canManageOrganizationBilling(access, target.companyId)) {
    throw new BillingForbiddenError('Only the organization’s owner or an administrator can manage its plan.')
  }
  if (purpose === 'buy' && !organizationIsVerified(access, target.companyId)) {
    throw new BillingForbiddenError('Organization Pro can be bought once your organization is verified by the Sea N Shore team, because its features only work for verified organizations.')
  }
  const organization = purpose === 'buy' ? await billingRepository.getOrganizationBillingOverview(target.companyId).catch(() => null) : null
  return { user, subject: { kind: 'company', companyId: target.companyId }, label: organization?.company.name ?? null }
}

function sameSubject(checkout: CheckoutRecord, subject: BillingSubject) {
  if (checkout.subject.kind !== subject.kind) return false
  return checkout.subject.kind === 'profile'
    ? subject.kind === 'profile' && checkout.subject.profileId === subject.profileId
    : subject.kind === 'company' && checkout.subject.companyId === subject.companyId
}

function refresh(subject: BillingSubject) {
  for (const path of billingPaths(subject)) revalidatePath(path)
}

function gatewayMessage(error: BillingGatewayError) {
  if (error.reason === 'subscriptions_unavailable') return AUTOPAY_UNAVAILABLE_MESSAGE
  const detail = error.providerMessage ? ` (${error.providerMessage.replace(/\.$/, '')})` : ''
  return `Our payment partner couldn’t start auto-pay just now${detail}. No money was taken. Please try again in a few minutes.`
}

/**
 * Starts auto-renew for Creator Pro (personal) or Organization Pro (organization owner
 * or administrator). Returns the Cashfree subscription session for the browser SDK.
 */
export async function startPlanCheckoutAction(input: {
  target: PlanCheckoutTarget
  interval: BillingInterval
  phone?: string
  email?: string
}): Promise<StartPlanCheckoutResult> {
  const parsed = startSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Choose monthly, half-yearly or yearly, then try again.' }
  try {
    const { user, subject, label } = await authorize(parsed.data.target, 'buy')
    const started = await subscriptionService.startCheckout({
      subject,
      actor: { id: user.id, email: user.email },
      interval: parsed.data.interval,
      typedPhone: parsed.data.phone || null,
      typedEmail: parsed.data.email || null,
      label,
    })
    refresh(subject)
    return { ok: true, checkoutId: started.checkoutId, subscriptionSessionId: started.subscriptionSessionId, mode: started.mode }
  } catch (error) {
    if (error instanceof BillingForbiddenError) return { ok: false, error: error.userMessage }
    if (error instanceof BillingNotConfiguredError) return { ok: false, error: BILLING_NOT_CONFIGURED_MESSAGE }
    if (error instanceof PlanPriceUnavailableError) return { ok: false, error: 'This plan isn’t available to buy right now. Please try again later or contact the Sea N Shore team.' }
    if (error instanceof AlreadySubscribedError) {
      return {
        ok: false,
        error: error.code === 'same_plan_renewing'
          ? 'You already have this plan on auto-renew. Nothing new was set up.'
          : 'This plan was given to you by the Sea N Shore team without an end date, so there is nothing to pay for.',
      }
    }
    if (error instanceof ContactDetailsRequiredError) {
      const message = error.invalid.phone
        ? (parsed.data.phone ? PHONE_INVALID_MESSAGE : PHONE_REJECTED_MESSAGE)
        : error.invalid.email
          ? EMAIL_INVALID_MESSAGE
          : CONTACT_REQUIRED_MESSAGE
      return { ok: false, error: message, needsContact: error.missing }
    }
    if (error instanceof BillingGatewayError) {
      return { ok: false, error: gatewayMessage(error), ...(error.reason === 'subscriptions_unavailable' ? { reason: 'subscriptions_unavailable' as const } : {}) }
    }
    console.error('plan_checkout_start_failed', { message: error instanceof Error ? error.message : null })
    return { ok: false, error: 'We couldn’t start auto-pay just now. No money was taken. Please try again.' }
  }
}

export type StartPlanTrialResult = { ok: true; message: string; endsOn: string | null } | { ok: false; error: string }

/**
 * Starts the free trial (Creator Pro for the member, Organization Pro for an organization
 * the member owns or administers). No payment details; one trial per subject, ever.
 */
export async function startPlanTrialAction(input: { target: PlanCheckoutTarget }): Promise<StartPlanTrialResult> {
  const parsed = targetSchema.safeParse(input?.target)
  if (!parsed.success) return { ok: false, error: 'We couldn’t find this plan. Refresh the page and try again.' }
  try {
    const { user, subject } = await authorize(parsed.data, 'buy')
    const { trial } = await trialService.start({ subject, actor: { type: 'member', profileId: user.id } })
    refresh(subject)
    const label = PLAN_LABELS[trial.planCode]
    const endsOn = formatBillingDate(trial.endsAt)
    return {
      ok: true,
      endsOn,
      message: `${label} is on. Your ${TRIAL_MONTHS[trial.planCode]}-month free trial ends on ${endsOn}; nothing is charged before then.`,
    }
  } catch (error) {
    if (error instanceof BillingForbiddenError) return { ok: false, error: error.userMessage }
    if (error instanceof TrialNotAvailableError) {
      return {
        ok: false,
        error: error.code === 'already_used'
          ? 'The free trial can only be used once, and this one has already been used.'
          : 'A plan is already active here, so there is nothing to try for free.',
      }
    }
    console.error('plan_trial_start_failed', { message: error instanceof Error ? error.message : null })
    return { ok: false, error: 'We couldn’t start the free trial just now. Please try again.' }
  }
}

function stateOf(checkout: CheckoutRecord): PlanCheckoutState {
  if (checkout.status === 'active' || checkout.status === 'on_hold') return 'active'
  if (checkout.status === 'pending_approval') return 'pending_approval'
  if (checkout.status === 'failed') return 'failed'
  if (checkout.status === 'created') return 'waiting'
  return 'closed'
}

/**
 * The page asks "is it approved yet?". The server re-reads the mandate from Cashfree
 * (at most every few seconds) and answers from the database — never from the browser.
 */
export async function checkPlanCheckoutAction(checkoutId: string): Promise<CheckPlanCheckoutResult> {
  const id = z.string().uuid().safeParse(checkoutId)
  if (!id.success) return checkoutStateCopy('unknown', { planLabel: 'Your plan' })
  try {
    const existing = await subscriptionRepository.getCheckout(id.data)
    if (!existing) return checkoutStateCopy('unknown', { planLabel: 'Your plan' })
    const target: PlanCheckoutTarget = existing.subject.kind === 'profile'
      ? { kind: 'personal' }
      : { kind: 'organization', companyId: existing.subject.companyId }
    const { subject } = await authorize(target, 'manage')
    if (!sameSubject(existing, subject)) return checkoutStateCopy('unknown', { planLabel: 'Your plan' })
    let checkout = existing
    try {
      checkout = (await subscriptionService.refreshCheckout(existing.id)) ?? existing
    } catch (error) {
      console.error('plan_checkout_check_failed', { message: error instanceof Error ? error.message : null })
      if (existing.status === 'created') return checkoutStateCopy('unknown', { planLabel: PLAN_LABELS[existing.planCode] })
    }
    const state = stateOf(checkout)
    if (state !== 'waiting') refresh(subject)
    return checkoutStateCopy(state, {
      planLabel: PLAN_LABELS[checkout.planCode],
      renewsOn: formatBillingDate(checkout.nextChargeAt),
    })
  } catch (error) {
    if (error instanceof BillingForbiddenError) return { state: 'unknown', title: 'You can’t view this plan', message: error.userMessage }
    console.error('plan_checkout_check_failed', { message: error instanceof Error ? error.message : null })
    return checkoutStateCopy('unknown', { planLabel: 'Your plan' })
  }
}

/** Turns auto-renew off (Cashfree CANCEL). Access continues to the end of the paid period. */
export async function cancelAutoRenewAction(input: { target: PlanCheckoutTarget }): Promise<CancelAutoRenewResult> {
  const parsed = targetSchema.safeParse(input?.target)
  if (!parsed.success) return { ok: false, error: 'We couldn’t find this plan. Refresh the page and try again.' }
  try {
    const { user, subject } = await authorize(parsed.data, 'manage')
    const result = await subscriptionService.cancelAutoRenew({ subject, actorProfileId: user.id })
    refresh(subject)
    const until = formatBillingDate(result.access?.periodEndsAt ?? result.checkout.paidThroughAt)
    const label = PLAN_LABELS[result.checkout.planCode]
    return {
      ok: true,
      message: until && result.access && result.access.status !== 'cancelled' && result.access.status !== 'expired'
        ? `Auto-renew is off. ${label} stays active until ${until}, and nothing more will be charged.`
        : `Auto-renew is off and nothing more will be charged. ${label} has ended because no paid period was left.`,
    }
  } catch (error) {
    if (error instanceof BillingForbiddenError) return { ok: false, error: error.userMessage }
    if (error instanceof NothingToCancelError) return { ok: false, error: 'Auto-renew is already off for this plan. Refresh the page to see the latest status.' }
    if (error instanceof BillingNotConfiguredError) return { ok: false, error: 'Online payments are switched off right now, so auto-renew can’t be changed here. Contact the Sea N Shore team and we’ll turn it off for you.' }
    if (error instanceof BillingGatewayError) return { ok: false, error: 'Our payment partner didn’t confirm the cancellation, so auto-renew is still on. Please try again in a few minutes.' }
    console.error('plan_cancel_failed', { message: error instanceof Error ? error.message : null })
    return { ok: false, error: 'We couldn’t turn off auto-renew just now. Nothing was changed. Please try again.' }
  }
}
