import type { ReactNode } from 'react'
import { Building2, Check, Crown, UserRound } from 'lucide-react'
import {
  BILLING_INTERVALS,
  INTERVAL_LABELS,
  formatRupeesShort,
  intervalSaving,
  trialBadge,
  type BillingInterval,
  type PaidPlanCode,
} from '@/features/billing/plans'
import type { PlanPrice } from '@/features/billing/subscription-types'

/**
 * The three Sea N Shore plans as cards. Shared by the signed-in /plans page and the
 * public /pricing page; each page supplies its own buttons.
 */

export const MEMBER_FEATURES = [
  'Profile',
  'Feed / community',
  'Connections / followers',
  'Messaging',
  'Search',
  'Apply for jobs',
  'Join events',
  'Enroll in courses',
  'Follow organizations',
]

export const CREATOR_FEATURES = [
  'Everything in Member',
  'Post Jobs',
  'Create Events',
  'Create Courses / LMS',
]

export const ORGANIZATION_FEATURES = [
  'Organization page',
  'Jobs',
  'Events',
  'LMS',
  'Multiple admins',
  'Applicant management',
  'Student management',
  'Analytics',
  'Branding',
  'Team permissions',
  'Company verification',
]

/** Button style for the light cards (Member, Creator Pro). */
export const PLAN_ACTION_CLASS =
  'inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900'
/** Secondary (outlined) button style for the light cards. */
export const PLAN_SECONDARY_ACTION_CLASS =
  'inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-xl border border-mist-200 bg-white px-5 py-2.5 text-sm font-bold text-navy-950 transition hover:border-ocean-300 hover:bg-mist-50'
/** Button style for the dark Organization Pro card. */
export const PLAN_DARK_ACTION_CLASS =
  'inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-navy-950 transition hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'

function FeatureList({ items, compact = false }: { items: string[]; compact?: boolean }) {
  return (
    <ul className={`mt-5 grid gap-2.5 ${compact ? 'max-md:mt-3 max-md:gap-1.5' : ''}`}>
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm leading-6 text-navy-900">
          <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-teal-700" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export type PlanPriceSummary = Record<BillingInterval, number | null>

/** The active price of each billing interval for `plan` (null where none is active). */
export function summarizePlanPrices(prices: PlanPrice[], plan: PaidPlanCode): PlanPriceSummary {
  const find = (interval: BillingInterval) =>
    prices.find((price) => price.planCode === plan && price.interval === interval && price.active !== false)?.amountMinor ?? null
  return Object.fromEntries(BILLING_INTERVALS.map((interval) => [interval, find(interval)])) as PlanPriceSummary
}

/** True when no interval has a price (the prices could not be loaded). */
export function hasAnyPrice(prices: PlanPriceSummary) {
  return BILLING_INTERVALS.some((interval) => prices[interval] !== null)
}

/**
 * The longer intervals with a price, as "or ₹10,000 / 6 months — save ₹1,994" lines: the
 * saving compares one payment with the same number of monthly payments (intervalSaving).
 */
export function longerIntervalLines(prices: PlanPriceSummary) {
  return BILLING_INTERVALS.filter((interval) => interval !== 'month' && prices[interval] !== null).map((interval) => {
    const amount = prices[interval] as number
    const saving = prices.month !== null ? intervalSaving(prices.month, amount, interval) : null
    const text = `${prices.month !== null ? 'or ' : ''}${formatRupeesShort(amount)} / ${INTERVAL_LABELS[interval].noun}${saving ? ` — save ${formatRupeesShort(saving.savingMinor)}` : ''}`
    return { interval, amount, saving, text }
  })
}

/** "3 months free" pill for a paid plan card; light (teal on white) or dark (white on navy) card. */
export function TrialBadge({ plan, dark = false }: { plan: PaidPlanCode; dark?: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${dark ? 'bg-white/15 text-white' : 'bg-teal-50 text-teal-800'}`}>
      {trialBadge(plan)}
    </span>
  )
}

/** Real prices from plan_prices; `unavailableText` is shown when they cannot be loaded. */
function PriceBlock({ plan, prices, dark = false, unavailableText, compact = false }: { plan: PaidPlanCode; prices: PlanPriceSummary; dark?: boolean; unavailableText: string; compact?: boolean }) {
  if (!hasAnyPrice(prices)) {
    return (
      <div className="mt-2">
        <TrialBadge plan={plan} dark={dark} />
        <p className={`mt-2 text-sm ${dark ? 'text-white/70' : 'text-muted'}`}>{unavailableText}</p>
        <p className={`mt-1 text-xs ${dark ? 'text-white/60' : 'text-muted'}`}>Start with a free trial, no payment details needed.</p>
      </div>
    )
  }
  const longer = longerIntervalLines(prices)
  return (
    <div className="mt-2">
      <TrialBadge plan={plan} dark={dark} />
      {prices.month !== null ? (
        <p className={`mt-2 text-3xl font-bold ${compact ? 'max-md:text-2xl' : ''} ${dark ? 'text-white' : 'text-navy-950'}`}>
          {formatRupeesShort(prices.month)}<span className={`text-base font-semibold ${dark ? 'text-white/70' : 'text-muted'}`}> / month</span>
        </p>
      ) : null}
      {longer.map((line) => (
        <p key={line.interval} className={`mt-1 text-sm font-semibold ${dark ? 'text-teal-200' : 'text-teal-800'}`}>
          {line.text}
        </p>
      ))}
      <p className={`mt-1 text-xs ${dark ? 'text-white/60' : 'text-muted'}`}>Start with a free trial, no payment details needed.</p>
      <p className={`mt-1 text-xs ${dark ? 'text-white/60' : 'text-muted'}`}>Renews automatically. Cancel auto-renew any time.</p>
    </div>
  )
}

export function PlanCards({
  prices,
  memberAction,
  creatorAction,
  organizationAction,
  unavailablePriceText = 'Price shown at checkout',
  compactOnPhones = false,
}: {
  prices: PlanPrice[]
  memberAction?: ReactNode
  creatorAction: ReactNode
  organizationAction: ReactNode
  unavailablePriceText?: string
  /** Smaller cards below md (the signed-in /plans page, round 8); desktop is unchanged. */
  compactOnPhones?: boolean
}) {
  const creatorPrices = summarizePlanPrices(prices, 'creator_pro')
  const organizationPrices = summarizePlanPrices(prices, 'organization_pro')
  const compact = compactOnPhones
  const card = compact ? 'max-md:rounded-2xl max-md:p-4' : ''
  const icon = compact ? 'max-md:hidden' : ''
  const eyebrow = compact ? 'max-md:mt-0' : ''
  const title = compact ? 'max-md:text-lg' : ''
  const action = compact ? 'max-md:pt-4' : ''

  return (
    <section aria-label="Plans" className={`grid gap-5 lg:grid-cols-3 ${compact ? 'max-md:gap-3' : ''}`}>
      <article className={`flex flex-col rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] ${card}`}>
        <span className={`grid size-11 place-items-center rounded-xl bg-mist-50 text-ocean-700 ${icon}`}>
          <UserRound aria-hidden="true" className="size-5" />
        </span>
        <p className={`mt-5 text-xs font-bold uppercase tracking-[0.16em] text-muted ${eyebrow}`}>For everyone</p>
        <h2 className={`mt-1 text-2xl font-bold text-navy-950 ${title}`}>Sea N Shore Member</h2>
        <p className={`mt-2 text-3xl font-bold text-navy-950 ${compact ? 'max-md:mt-1 max-md:text-2xl' : ''}`}>FREE</p>
        <FeatureList items={MEMBER_FEATURES} compact={compact} />
        {memberAction ? <div className={`mt-auto pt-6 ${action}`}>{memberAction}</div> : null}
      </article>

      <article className={`flex flex-col rounded-[1.75rem] border border-teal-200 bg-white p-6 shadow-[var(--shadow-card)] ring-1 ring-teal-100 ${card}`}>
        <span className={`grid size-11 place-items-center rounded-xl bg-teal-50 text-teal-700 ${icon}`}>
          <Crown aria-hidden="true" className="size-5" />
        </span>
        <p className={`mt-5 text-xs font-bold uppercase tracking-[0.16em] text-teal-700 ${eyebrow}`}>Independent creators</p>
        <h2 className={`mt-1 text-2xl font-bold text-navy-950 ${title}`}>Creator Pro</h2>
        <PriceBlock plan="creator_pro" prices={creatorPrices} unavailableText={unavailablePriceText} compact={compact} />
        <p className="mt-3 text-sm leading-6 text-muted">For recruiters, consultants, trainers, coaches and event organizers.</p>
        <FeatureList items={CREATOR_FEATURES} compact={compact} />
        <div className={`mt-auto pt-6 ${action}`}>{creatorAction}</div>
      </article>

      <article className={`flex flex-col rounded-[1.75rem] border border-mist-100 bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] ${card}`}>
        <span className={`grid size-11 place-items-center rounded-xl bg-white/10 text-teal-200 ${icon}`}>
          <Building2 aria-hidden="true" className="size-5" />
        </span>
        <p className={`mt-5 text-xs font-bold uppercase tracking-[0.16em] text-teal-200 ${eyebrow}`}>Companies & institutions</p>
        <h2 className={`mt-1 text-2xl font-bold ${title}`}>Organization Pro</h2>
        <PriceBlock plan="organization_pro" prices={organizationPrices} dark unavailableText={unavailablePriceText} compact={compact} />
        <p className="mt-3 text-sm leading-6 text-white/70">
          For shipping companies, manning agencies, training institutes, colleges, survey companies, service companies and associations.
        </p>
        <div className="[&_li]:text-white/85 [&_svg]:text-teal-200">
          <FeatureList items={ORGANIZATION_FEATURES} compact={compact} />
        </div>
        <div className={`mt-auto pt-6 ${action}`}>{organizationAction}</div>
      </article>
    </section>
  )
}
