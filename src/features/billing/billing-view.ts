import { INTERVAL_LABELS, PLAN_LABELS, formatRupees, yearlySaving, type BillingInterval, type PaidPlanCode } from './plans'
import type { SubjectBilling } from './subscription-repository'
import type { PaymentRecord, PlanPrice } from './subscription-types'

/**
 * Turns the stored billing state into what the billing pages show, in plain words.
 * Pure: the pages and their tests both use it.
 */

export type PlanBillingState =
  /** No paid plan: choose monthly or yearly. */
  | 'free'
  /** Auto-renewing and paid up (or waiting for the first charge after approval). */
  | 'active'
  /** The last renewal failed; access continues during the grace period. */
  | 'past_due'
  /** Auto-renew is off; the plan ends at the end of the paid period. */
  | 'cancelling'
  /** Given by the Sea N Shore team (no payment mandate). */
  | 'manual'

export type BillingHistoryRow = {
  id: string
  date: string
  description: string
  amount: string
  status: string
  tone: 'success' | 'pending' | 'failed' | 'neutral'
}

export type PlanBillingView = {
  plan: PaidPlanCode
  planLabel: string
  configured: boolean
  prices: { month: { id: string; amountMinor: number } | null; year: { id: string; amountMinor: number } | null }
  /** e.g. "Save ₹200.00 a year — 2 months free", when yearly is cheaper. */
  yearlySavingLabel: string | null
  state: PlanBillingState
  statusLabel: string
  statusHelp: string
  current: {
    interval: BillingInterval | null
    priceLabel: string | null
    /** Next automatic payment, when auto-renew is on. */
    renewsOn: string | null
    /** Last day of access (period end, or the end of the grace period). */
    accessUntil: string | null
    /** End of the last period actually paid for; access continues to here after cancelling. */
    paidThrough: string | null
    paymentMethod: string | null
    autoRenew: boolean
  } | null
  /** A mandate waiting for the customer or their bank. */
  pending: { checkoutId: string; status: 'created' | 'pending_approval' | 'failed'; interval: BillingInterval; priceLabel: string; startsAt: string | null } | null
  /** When the last paid plan ended (for Free after a paid plan). */
  endedOn: string | null
  actions: {
    choosePlan: boolean
    /** When choosing now, the new plan starts on this date (end of the current one). */
    chooseStartsOn: string | null
    cancelAutoRenew: boolean
    switchToYearly: boolean
    resumeAutoRenew: boolean
    updatePaymentMethod: boolean
  }
  history: BillingHistoryRow[]
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  upi: 'UPI AutoPay',
  card: 'Card (auto-debit)',
  enach: 'Bank account (eNACH mandate)',
  pnach: 'Bank account (paper NACH mandate)',
}

export function paymentMethodLabel(value: string | null) {
  if (!value) return null
  return PAYMENT_METHOD_LABELS[value] ?? 'Auto-pay mandate'
}

export function formatBillingDate(value: string | null | undefined, timeZone = 'Asia/Kolkata') {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(date)
}

function priceLabel(amountMinor: number, interval: BillingInterval) {
  return `${formatRupees(amountMinor)} ${INTERVAL_LABELS[interval].per}`
}

/** "₹1,000.00 per month or ₹10,000.00 per year" from the active prices; null when none. */
export function planPriceLine(prices: readonly PlanPrice[], plan: PaidPlanCode) {
  const parts = (['month', 'year'] as const).flatMap((interval) => {
    const price = prices.find((entry) => entry.planCode === plan && entry.interval === interval && entry.active)
    return price ? [priceLabel(price.amountMinor, interval)] : []
  })
  return parts.length ? parts.join(' or ') : null
}

function historyRow(payment: PaymentRecord, plan: PaidPlanCode, intervalFor: (checkoutId: string) => BillingInterval | null): BillingHistoryRow {
  const date = formatBillingDate(payment.paidAt ?? payment.scheduledFor ?? payment.createdAt) ?? ''
  const interval = intervalFor(payment.checkoutId)
  const period = payment.periodStart && payment.periodEnd
    ? ` · ${formatBillingDate(payment.periodStart)} – ${formatBillingDate(payment.periodEnd)}`
    : ''
  const description = payment.paymentType === 'AUTH'
    ? 'Auto-pay approval'
    : `${PLAN_LABELS[plan]}${interval ? ` · ${INTERVAL_LABELS[interval].adjective.toLowerCase()}` : ''}${period}`
  const status = payment.status === 'success'
    ? { status: 'Paid', tone: 'success' as const }
    : payment.status === 'failed'
      ? { status: 'Failed — not charged', tone: 'failed' as const }
      : payment.status === 'cancelled'
        ? { status: 'Cancelled — not charged', tone: 'neutral' as const }
        : { status: 'Scheduled', tone: 'pending' as const }
  return { id: payment.id, date, description, amount: formatRupees(payment.amountMinor), ...status }
}

export function buildPlanBillingView(input: {
  plan: PaidPlanCode
  billing: SubjectBilling
  prices: PlanPrice[]
  configured: boolean
  now?: Date
}): PlanBillingView {
  const now = input.now ?? new Date()
  const { billing, plan } = input
  const planLabel = PLAN_LABELS[plan]
  const month = input.prices.find((price) => price.planCode === plan && price.interval === 'month' && price.active) ?? null
  const year = input.prices.find((price) => price.planCode === plan && price.interval === 'year' && price.active) ?? null
  const saving = month && year ? yearlySaving(month.amountMinor, year.amountMinor) : null
  const yearlySavingLabel = saving
    ? `Save ${formatRupees(saving.savingMinor)} a year${saving.monthsFree >= 1 ? ` — ${saving.monthsFree} month${saving.monthsFree === 1 ? '' : 's'} free` : ''}`
    : null

  const { access, checkout } = billing
  const current = billing.accessIsCurrent ? access : null
  const pendingSource = billing.pendingCheckout
  const pending = pendingSource && (pendingSource.status === 'created' || pendingSource.status === 'pending_approval' || pendingSource.status === 'failed')
    ? {
        checkoutId: pendingSource.id,
        status: pendingSource.status,
        interval: pendingSource.interval,
        priceLabel: priceLabel(pendingSource.amountMinor, pendingSource.interval),
        startsAt: formatBillingDate(pendingSource.startsAt),
      }
    : null

  const intervals = new Map<string, BillingInterval>()
  if (checkout) intervals.set(checkout.id, checkout.interval)
  if (pendingSource) intervals.set(pendingSource.id, pendingSource.interval)
  const history = billing.payments.map((payment) => historyRow(payment, plan, (id) => intervals.get(id) ?? null))

  const base = {
    plan,
    planLabel,
    configured: input.configured,
    prices: {
      month: month ? { id: month.id, amountMinor: month.amountMinor } : null,
      year: year ? { id: year.id, amountMinor: year.amountMinor } : null,
    },
    yearlySavingLabel,
    pending,
    history,
  }

  if (!current) {
    const ended = access && access.periodEndsAt && Date.parse(access.periodEndsAt) <= now.getTime() ? formatBillingDate(access.periodEndsAt) : null
    return {
      ...base,
      state: 'free',
      statusLabel: 'Free plan',
      statusHelp: plan === 'organization_pro'
        ? (ended ? `This organization’s ${planLabel} plan ended on ${ended}. It is on the free plan now.` : 'This organization is on the free plan.')
        : (ended ? `Your ${planLabel} plan ended on ${ended}.` : 'You are on the free Sea N Shore Member plan.'),
      current: null,
      endedOn: ended,
      actions: { choosePlan: true, chooseStartsOn: null, cancelAutoRenew: false, switchToYearly: false, resumeAutoRenew: false, updatePaymentMethod: false },
    }
  }

  const accessUntil = formatBillingDate(current.periodEndsAt)
  if (current.billingProvider !== 'cashfree' || !checkout) {
    return {
      ...base,
      state: 'manual',
      statusLabel: 'Active — given by the Sea N Shore team',
      statusHelp: accessUntil
        ? `No payment is set up for this plan. It stays active until ${accessUntil}. You can set up auto-renew to start after that date.`
        : 'No payment is set up for this plan and it has no end date.',
      current: { interval: null, priceLabel: null, renewsOn: null, accessUntil, paidThrough: accessUntil, paymentMethod: null, autoRenew: false },
      endedOn: null,
      actions: {
        choosePlan: Boolean(current.periodEndsAt),
        chooseStartsOn: accessUntil,
        cancelAutoRenew: false,
        switchToYearly: false,
        resumeAutoRenew: false,
        updatePaymentMethod: false,
      },
    }
  }

  const paidThrough = formatBillingDate(checkout.paidThroughAt)
  const renewsOn = formatBillingDate(checkout.nextChargeAt ?? checkout.paidThroughAt)
  const details = {
    interval: checkout.interval,
    priceLabel: priceLabel(checkout.amountMinor, checkout.interval),
    renewsOn: null as string | null,
    accessUntil,
    paidThrough: checkout.paidThroughAt && Date.parse(checkout.paidThroughAt) > now.getTime() ? paidThrough : null,
    paymentMethod: paymentMethodLabel(checkout.paymentMethod),
    autoRenew: !current.cancelAtPeriodEnd,
  }
  const monthlyNow = checkout.interval === 'month'

  if (current.cancelAtPeriodEnd) {
    const until = paidThrough ?? accessUntil
    return {
      ...base,
      state: 'cancelling',
      statusLabel: 'Auto-renew is off',
      statusHelp: `${planLabel} stays active until ${until}. After that your account moves to the free plan. Nothing more will be charged.`,
      current: { ...details, accessUntil: until },
      endedOn: null,
      actions: { choosePlan: false, chooseStartsOn: until, cancelAutoRenew: false, switchToYearly: false, resumeAutoRenew: true, updatePaymentMethod: false },
    }
  }

  if (current.status === 'past_due') {
    return {
      ...base,
      state: 'past_due',
      statusLabel: 'Payment didn’t go through',
      statusHelp: `We couldn’t take your ${details.priceLabel} renewal payment. Our payment partner retries automatically. Your plan stays active until ${accessUntil} — make sure your account has enough balance, or set up a different payment method.`,
      current: { ...details, renewsOn: null },
      endedOn: null,
      actions: { choosePlan: false, chooseStartsOn: null, cancelAutoRenew: true, switchToYearly: false, resumeAutoRenew: false, updatePaymentMethod: true },
    }
  }

  const firstChargePending = !checkout.paidThroughAt
  return {
    ...base,
    state: 'active',
    statusLabel: 'Active — renews automatically',
    statusHelp: firstChargePending
      ? `Auto-pay is approved. The first payment of ${formatRupees(checkout.amountMinor)} is taken${renewsOn ? ` on ${renewsOn}` : ' within a few days'}; you can use ${planLabel} now.`
      : `Paid until ${paidThrough}. The next payment of ${formatRupees(checkout.amountMinor)} is taken automatically on ${renewsOn}.`,
    current: { ...details, renewsOn },
    endedOn: null,
    actions: {
      choosePlan: false,
      chooseStartsOn: paidThrough,
      cancelAutoRenew: true,
      switchToYearly: monthlyNow && Boolean(year),
      resumeAutoRenew: false,
      updatePaymentMethod: false,
    },
  }
}
