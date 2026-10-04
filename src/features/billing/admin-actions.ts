'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withTransaction } from '@/lib/db/client'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { parsePriceToMinor } from '@/features/payments/currency'
import { formatBillingDate } from './billing-view'
import { addDays, BILLING_INTERVALS, INTERVAL_LABELS, PLAN_LABELS, formatRupees } from './plans'
import { trialService } from './trial-service'
import { TrialNotRunningError } from './trials'
import { endManualSubscription, PlanPriceError, replacePlanPrice, subscriptionRepository } from './subscription-repository'
import { BillingGatewayError, BillingNotConfiguredError, billingPaths, NothingToCancelError, subscriptionService } from './subscription-service'

export type AdminBillingResult = { ok: true; message: string } | { ok: false; error: string }

const ADMIN_PATHS = ['/admin/billing', '/plans', '/settings/billing']

async function requireAdmin() {
  try {
    return await requirePlatformAdministratorUser()
  } catch {
    return null
  }
}

const priceSchema = z.object({
  plan: z.enum(['creator_pro', 'organization_pro']),
  interval: z.enum(BILLING_INTERVALS),
  amount: z.string().trim().min(1).max(20),
})

/**
 * New price for new subscribers. Creates a new plan_prices row (and later a new Cashfree
 * plan); everyone already subscribed keeps paying the price they signed up for.
 */
export async function updatePlanPriceAction(input: { plan: string; interval: string; amount: string }): Promise<AdminBillingResult> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, error: 'Only Sea N Shore administrators can change prices.' }
  const parsed = priceSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Enter the new price in rupees, for example 1000 or 999.50.' }
  const amountMinor = parsePriceToMinor(parsed.data.amount, 'INR')
  if (amountMinor === null || Number.isNaN(amountMinor)) return { ok: false, error: 'Enter the new price in rupees, for example 1000 or 999.50.' }
  if (amountMinor < 100 || amountMinor > 100000000) return { ok: false, error: 'Prices must be between ₹1.00 and ₹10,00,000.00.' }
  try {
    const price = await withTransaction((tx) => replacePlanPrice(tx, {
      plan: parsed.data.plan,
      interval: parsed.data.interval,
      amountMinor,
      adminId: admin.id,
    }))
    for (const path of ADMIN_PATHS) revalidatePath(path)
    return {
      ok: true,
      message: `${PLAN_LABELS[price.planCode]} ${INTERVAL_LABELS[price.interval].adjective.toLowerCase()} is now ${formatRupees(price.amountMinor)} for new subscribers. Existing subscribers keep their current price.`,
    }
  } catch (error) {
    if (error instanceof PlanPriceError && error.code === 'price_unchanged') return { ok: false, error: 'That is already the current price. Nothing was changed.' }
    if (error instanceof PlanPriceError) return { ok: false, error: 'Prices must be between ₹1.00 and ₹10,00,000.00.' }
    console.error('admin_plan_price_failed', { message: error instanceof Error ? error.message : null })
    return { ok: false, error: 'The price could not be saved. Nothing was changed. Please try again.' }
  }
}

const cancelSchema = z.object({ accessId: z.string().uuid(), mode: z.enum(['period_end', 'now']) })

/** Admin cancel: stop auto-renew (access to period end) or end access now. */
export async function adminCancelSubscriptionAction(input: { accessId: string; mode: 'period_end' | 'now' }): Promise<AdminBillingResult> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, error: 'Only Sea N Shore administrators can cancel subscriptions.' }
  const parsed = cancelSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'We couldn’t find this subscription. Refresh the page and try again.' }
  const endNow = parsed.data.mode === 'now'
  try {
    const access = await subscriptionRepository.getAccessById(parsed.data.accessId)
    if (!access) return { ok: false, error: 'We couldn’t find this subscription. Refresh the page and try again.' }
    const checkout = access.billingProvider === 'cashfree' && access.providerSubscriptionId
      ? await subscriptionRepository.getCheckoutByProviderSubscriptionId(access.providerSubscriptionId)
      : null
    let accessUntil: string | null = null
    if (checkout) {
      const result = await subscriptionService.cancelCheckout(checkout, { actorProfileId: admin.id, actorType: 'admin', endNow })
      accessUntil = result.access?.periodEndsAt ?? null
    } else {
      const ended = await withTransaction((tx) => endManualSubscription(tx, { accessId: access.id, adminId: admin.id, endNow, now: new Date() }))
      accessUntil = ended?.periodEndsAt ?? null
    }
    for (const path of [...ADMIN_PATHS, ...billingPaths(access.subject)]) revalidatePath(path)
    const label = PLAN_LABELS[access.planCode]
    return {
      ok: true,
      message: endNow
        ? `${label} has ended now and nothing more will be charged.`
        : `Auto-renew is off. ${label} stays active until ${formatBillingDate(accessUntil) ?? 'the end of its period'}, and nothing more will be charged.`,
    }
  } catch (error) {
    if (error instanceof NothingToCancelError) return { ok: false, error: 'This subscription is already cancelled.' }
    if (error instanceof BillingNotConfiguredError) return { ok: false, error: 'Cashfree is not connected (or is set to a different environment than this subscription), so the mandate can’t be cancelled from here. Cancel it in the Cashfree dashboard.' }
    if (error instanceof BillingGatewayError) return { ok: false, error: `Cashfree didn’t confirm the cancellation${error.providerMessage ? ` (${error.providerMessage.replace(/\.$/, '')})` : ''}. Nothing was changed. Try again, or cancel it in the Cashfree dashboard.` }
    console.error('admin_subscription_cancel_failed', { message: error instanceof Error ? error.message : null })
    return { ok: false, error: 'The subscription could not be cancelled just now. Nothing was changed. Please try again.' }
  }
}

const extendTrialSchema = z.object({ trialId: z.string().uuid(), days: z.number().int().min(1).max(365) })

/** Admin: give a running free trial more time (days from its current end). */
export async function adminExtendTrialAction(input: { trialId: string; days: number }): Promise<AdminBillingResult> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, error: 'Only Sea N Shore administrators can change trials.' }
  const parsed = extendTrialSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Enter how many days to add, between 1 and 365.' }
  try {
    const current = await subscriptionRepository.listTrialsForAdmin(500).then((rows) => rows.find((row) => row.trial.id === parsed.data.trialId)?.trial ?? null)
    if (!current) return { ok: false, error: 'We couldn’t find this trial. Refresh the page and try again.' }
    const base = Math.max(Date.parse(current.endsAt), Date.now())
    const result = await trialService.extend({ trialId: parsed.data.trialId, endsAt: addDays(new Date(base), parsed.data.days), actor: { type: 'admin', profileId: admin.id } })
    for (const path of [...ADMIN_PATHS, ...billingPaths(result.trial.subject)]) revalidatePath(path)
    return { ok: true, message: `The ${PLAN_LABELS[result.trial.planCode]} trial now ends on ${formatBillingDate(result.trial.endsAt)}.` }
  } catch (error) {
    if (error instanceof TrialNotRunningError) return { ok: false, error: 'This trial is not running any more, so it can’t be extended.' }
    console.error('admin_trial_extend_failed', { message: error instanceof Error ? error.message : null })
    return { ok: false, error: 'The trial could not be extended just now. Nothing was changed. Please try again.' }
  }
}

/** Admin: end a running free trial now; the account returns to the free plan at once. */
export async function adminEndTrialAction(input: { trialId: string }): Promise<AdminBillingResult> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, error: 'Only Sea N Shore administrators can change trials.' }
  const parsed = z.string().uuid().safeParse(input?.trialId)
  if (!parsed.success) return { ok: false, error: 'We couldn’t find this trial. Refresh the page and try again.' }
  try {
    const result = await trialService.end({ trialId: parsed.data, actor: { type: 'admin', profileId: admin.id } })
    for (const path of [...ADMIN_PATHS, ...billingPaths(result.trial.subject)]) revalidatePath(path)
    return { ok: true, message: `The ${PLAN_LABELS[result.trial.planCode]} trial has ended. The account is on the free plan now; nothing was deleted.` }
  } catch (error) {
    if (error instanceof TrialNotRunningError) return { ok: false, error: 'This trial is not running any more.' }
    console.error('admin_trial_end_failed', { message: error instanceof Error ? error.message : null })
    return { ok: false, error: 'The trial could not be ended just now. Nothing was changed. Please try again.' }
  }
}
