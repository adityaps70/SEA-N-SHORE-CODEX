import { AlertTriangle, CheckCircle2, Clock3, Crown, Building2, ReceiptText, XCircle } from 'lucide-react'
import type { BillingHistoryRow, PlanBillingView } from '../billing-view'
import type { CheckPlanCheckoutResult, PlanCheckoutTarget } from '../checkout-messages'
import { BILLING_INTERVALS, formatRupees } from '../plans'
import { CancelAutoRenewButton } from './cancel-auto-renew'
import type { PlanPriceSummary } from './plan-cards'
import { CheckoutStatusButton, PlanChangeButton } from './plan-change'
import { PlanCheckout } from './plan-checkout'
import { TrialStartButton } from './trial-start-button'

const STATE_TONES: Record<PlanBillingView['state'], string> = {
  free: 'bg-mist-100 text-navy-800',
  active: 'bg-emerald-50 text-emerald-800',
  past_due: 'bg-amber-100 text-amber-900',
  cancelling: 'bg-mist-100 text-navy-800',
  manual: 'bg-ocean-50 text-ocean-800',
  trialing: 'bg-teal-50 text-teal-800',
}

const NOTICE_TONES: Record<CheckPlanCheckoutResult['state'], { icon: typeof CheckCircle2; box: string }> = {
  active: { icon: CheckCircle2, box: 'border-emerald-200 bg-emerald-50 text-emerald-950' },
  pending_approval: { icon: Clock3, box: 'border-ocean-200 bg-ocean-50 text-navy-950' },
  waiting: { icon: Clock3, box: 'border-ocean-200 bg-ocean-50 text-navy-950' },
  failed: { icon: XCircle, box: 'border-rose-200 bg-rose-50 text-rose-950' },
  closed: { icon: XCircle, box: 'border-mist-200 bg-mist-50 text-navy-950' },
  unknown: { icon: AlertTriangle, box: 'border-amber-200 bg-amber-50 text-amber-950' },
}

function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="min-w-0">
      <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-navy-950">{value}</dd>
    </div>
  )
}

/** Result of coming back from Cashfree (?checkout=…), read from the database by the page. */
export function CheckoutNotice({ notice, checkoutId }: { notice: CheckPlanCheckoutResult; checkoutId: string }) {
  const tone = NOTICE_TONES[notice.state]
  const Icon = tone.icon
  return (
    <div role="status" className={`rounded-2xl border p-4 ${tone.box}`}>
      <div className="flex items-start gap-3">
        <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-bold">{notice.title}</p>
          <p className="text-sm leading-6">{notice.message}</p>
          {notice.state === 'waiting' || notice.state === 'pending_approval' || notice.state === 'unknown'
            ? <div className="pt-2"><CheckoutStatusButton checkoutId={checkoutId} /></div>
            : null}
        </div>
      </div>
    </div>
  )
}

export function PlanBillingPanel({ view, target, eyebrow, description, highlight = false, blockedMessage = null, anchorId, noticeCheckoutId = null }: {
  view: PlanBillingView
  target: PlanCheckoutTarget
  eyebrow: string
  description: string
  highlight?: boolean
  blockedMessage?: string | null
  anchorId?: string
  /** The checkout already shown in the notice above the panel (not repeated inside it). */
  noticeCheckoutId?: string | null
}) {
  const Icon = view.plan === 'creator_pro' ? Crown : Building2
  const prices = Object.fromEntries(BILLING_INTERVALS.map((interval) => [interval, view.prices[interval]?.amountMinor ?? null])) as PlanPriceSummary
  const trialing = view.state === 'trialing'
  const common = {
    target,
    planLabel: view.planLabel,
    prices,
    yearlySavingLabel: view.yearlySavingLabel,
    configured: view.configured,
    blockedMessage,
    // During a trial, a provider that is not open yet is shown as "Paid plans open soon", not as an error.
    trialEndsOn: trialing ? view.trial.endsOn : null,
  }
  const { current, actions } = view
  const pending = view.pending && view.pending.checkoutId !== noticeCheckoutId ? view.pending : null
  const showChooser = actions.choosePlan && !(view.pending && view.pending.status !== 'failed')

  return (
    <section
      id={anchorId}
      aria-labelledby={anchorId ? `${anchorId}-title` : undefined}
      className={`scroll-mt-24 rounded-2xl border bg-white p-5 shadow-[var(--shadow-card)] sm:p-6 ${highlight ? 'border-teal-300 ring-2 ring-teal-100' : 'border-mist-100'}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">
            <Icon aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">{eyebrow}</p>
            <h2 id={anchorId ? `${anchorId}-title` : undefined} className="mt-0.5 text-xl font-bold text-navy-950">{view.planLabel}</h2>
          </div>
        </div>
        <span className={`inline-flex w-fit shrink-0 items-center rounded-full px-3 py-1.5 text-xs font-bold ${STATE_TONES[view.state]}`}>
          {view.statusLabel}
        </span>
      </div>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted sm:pl-13">{description}</p>

      <p className="mt-4 text-sm leading-6 text-navy-800">{view.statusHelp}</p>

      {current ? (
        <dl className="mt-4 grid grid-cols-2 gap-4 rounded-xl bg-mist-50/70 p-4 lg:grid-cols-4">
          <Detail label="Price" value={current.priceLabel} />
          <Detail label="Next payment" value={trialing ? 'Nothing during the trial' : view.state === 'past_due' ? 'Retrying automatically' : current.autoRenew ? current.renewsOn ?? 'Within a few days' : 'None — auto-renew is off'} />
          {view.state === 'active'
            ? <Detail label="Paid until" value={current.paidThrough ?? 'First payment pending'} />
            : <Detail label={trialing ? 'Trial ends' : 'Active until'} value={current.accessUntil} />}
          <Detail label="Payment method" value={current.paymentMethod ?? (view.state === 'manual' || trialing ? 'None needed' : 'Auto-pay mandate')} />
        </dl>
      ) : null}

      {pending ? (
        <div className={`mt-4 rounded-2xl border p-4 ${pending.status === 'failed' ? 'border-rose-200 bg-rose-50/70' : 'border-ocean-200 bg-ocean-50/60'}`}>
          <p className="text-sm font-bold text-navy-950">
            {pending.status === 'failed'
              ? 'Your last auto-pay setup wasn’t approved'
              : pending.status === 'pending_approval'
                ? 'Waiting for your bank to approve auto-pay'
                : 'Auto-pay setup not finished'}
          </p>
          <p className="mt-1 text-sm leading-6 text-navy-800">
            {pending.status === 'failed'
              ? `No money was taken for ${pending.priceLabel}. Try again below, or use a different UPI app, card or bank account.`
              : pending.status === 'pending_approval'
                ? `${pending.priceLabel}. Bank account mandates can take up to 2 working days. ${view.planLabel} switches on${pending.startsAt ? ` from ${pending.startsAt}` : ''} as soon as it is approved.`
                : `${pending.priceLabel}. If you approved it in the Cashfree window, check the status. Otherwise start again below.`}
          </p>
          {pending.status !== 'failed' ? <div className="mt-3"><CheckoutStatusButton checkoutId={pending.checkoutId} /></div> : null}
        </div>
      ) : null}

      {actions.cancelAutoRenew || actions.switchToYearly || actions.resumeAutoRenew || actions.updatePaymentMethod ? (
        <div className="mt-5 flex flex-col gap-3 border-t border-mist-100 pt-5 sm:flex-row sm:flex-wrap sm:items-start">
          {actions.resumeAutoRenew ? (
            <PlanChangeButton
              {...common}
              label="Turn auto-renew back on"
              intro={`Approve a new auto-pay mandate. Nothing is charged before ${actions.chooseStartsOn ?? 'your current period ends'}; after that your plan renews automatically.`}
              startsOn={actions.chooseStartsOn}
              defaultInterval={current?.interval ?? 'month'}
            />
          ) : null}
          {actions.switchToYearly ? (
            <PlanChangeButton
              {...common}
              label="Switch to yearly"
              intro={`Your monthly plan runs until ${actions.chooseStartsOn ?? 'the end of this month'}. Approve a yearly mandate now and the yearly plan${view.yearlySavingLabel ? ` (${view.yearlySavingLabel.toLowerCase()})` : ''} starts on that date. Monthly auto-renew stops as soon as the yearly mandate is approved.`}
              onlyInterval="year"
              startsOn={actions.chooseStartsOn}
              submitLabel={prices.year !== null ? `Switch to yearly · ${formatRupees(prices.year)} per year` : 'Switch to yearly'}
            />
          ) : null}
          {actions.updatePaymentMethod ? (
            <PlanChangeButton
              {...common}
              label="Use a different payment method"
              intro="Approve a new auto-pay mandate with another UPI app, card or bank account. The overdue payment is taken through the new mandate and the old one is cancelled."
              defaultInterval={current?.interval ?? 'month'}
            />
          ) : null}
          {actions.cancelAutoRenew ? (
            <CancelAutoRenewButton target={target} planLabel={view.planLabel} accessUntil={current?.paidThrough ?? null} />
          ) : null}
        </div>
      ) : null}

      {showChooser && view.state === 'free' && view.trial.canStart && !blockedMessage ? (
        <div className="mt-5 rounded-2xl border border-teal-200 bg-teal-50/60 p-4" data-testid="trial-offer">
          <h3 className="text-base font-bold text-navy-950">Try {view.planLabel} free for {view.trial.months} months</h3>
          <p className="mt-1 text-sm leading-6 text-navy-800">
            No payment details needed and nothing is charged during the trial. You can choose a paid plan at any time; the first payment is taken on the day the trial ends. One free trial per {view.plan === 'organization_pro' ? 'organization' : 'member'}.
          </p>
          <div className="mt-3">
            <TrialStartButton target={target} planLabel={view.planLabel} months={view.trial.months} />
          </div>
        </div>
      ) : null}

      {showChooser ? (
        <div className="mt-5 border-t border-mist-100 pt-5">
          <h3 className="text-base font-bold text-navy-950">
            {view.state === 'manual' ? 'Set up auto-renew' : trialing ? 'Choose a plan' : view.trial.canStart && !blockedMessage ? 'Or choose a paid plan now' : `Get ${view.planLabel}`}
          </h3>
          {trialing ? (
            <p className="mt-1 text-sm leading-6 text-muted">Approve auto-pay now and keep {view.planLabel} without a break. The first payment is scheduled for {view.trial.endsOn ?? 'the day the trial ends'}; nothing is taken before then.</p>
          ) : null}
          <div className="mt-3">
            <PlanCheckout {...common} defaultInterval="year" startsOn={view.state === 'manual' || trialing ? actions.chooseStartsOn : null} />
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function BillingHistory({ rows, title = 'Billing history' }: { rows: BillingHistoryRow[]; title?: string }) {
  const tones: Record<BillingHistoryRow['tone'], string> = {
    success: 'bg-emerald-50 text-emerald-800',
    pending: 'bg-ocean-50 text-ocean-800',
    failed: 'bg-rose-50 text-rose-800',
    neutral: 'bg-mist-100 text-navy-700',
  }
  return (
    <section aria-labelledby="billing-history-title" className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-mist-50 text-ocean-700">
          <ReceiptText aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="billing-history-title" className="text-lg font-semibold text-navy-950">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted">Payments taken through your auto-pay mandate. These are payment records, not tax invoices. Cashfree also emails a receipt for each payment.</p>
        </div>
      </div>
      {rows.length ? (
        <ul className="mt-4 divide-y divide-mist-100 border-y border-mist-100">
          {rows.map((row) => (
            <li key={row.id} className="grid gap-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)_7rem_11rem] sm:items-center sm:gap-4">
              <span className="text-sm font-semibold text-navy-950">{row.date}</span>
              <span className="min-w-0 text-sm leading-6 text-navy-800">{row.description}</span>
              <span className="text-sm font-bold text-navy-950 sm:text-right">{row.amount}</span>
              <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-bold sm:justify-self-end ${tones[row.tone]}`}>{row.status}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-xl bg-mist-50 px-4 py-3 text-sm text-muted">No payments yet.</p>
      )}
    </section>
  )
}
