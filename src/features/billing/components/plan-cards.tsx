import type { ReactNode } from 'react'
import { Building2, Check, Crown, UserRound } from 'lucide-react'
import { formatRupeesShort, yearlySaving, type PaidPlanCode } from '@/features/billing/plans'
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

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="mt-5 grid gap-2.5">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm leading-6 text-navy-900">
          <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-teal-700" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export type PlanPriceSummary = { month: number | null; year: number | null }

export function summarizePlanPrices(prices: PlanPrice[], plan: PaidPlanCode): PlanPriceSummary {
  const find = (interval: 'month' | 'year') =>
    prices.find((price) => price.planCode === plan && price.interval === interval && price.active !== false)?.amountMinor ?? null
  return { month: find('month'), year: find('year') }
}

/** Real prices from plan_prices; `unavailableText` is shown when they cannot be loaded. */
function PriceBlock({ prices, dark = false, unavailableText }: { prices: PlanPriceSummary; dark?: boolean; unavailableText: string }) {
  if (prices.month === null && prices.year === null) {
    return <p className={`mt-2 text-sm ${dark ? 'text-white/70' : 'text-muted'}`}>{unavailableText}</p>
  }
  const saving = prices.month !== null && prices.year !== null ? yearlySaving(prices.month, prices.year) : null
  return (
    <div className="mt-2">
      {prices.month !== null ? (
        <p className={`text-3xl font-bold ${dark ? 'text-white' : 'text-navy-950'}`}>
          {formatRupeesShort(prices.month)}<span className={`text-base font-semibold ${dark ? 'text-white/70' : 'text-muted'}`}> / month</span>
        </p>
      ) : null}
      {prices.year !== null ? (
        <p className={`mt-1 text-sm font-semibold ${dark ? 'text-teal-200' : 'text-teal-800'}`}>
          {prices.month !== null ? 'or ' : ''}{formatRupeesShort(prices.year)} / year{saving ? ` — save ${formatRupeesShort(saving.savingMinor)}` : ''}
        </p>
      ) : null}
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
}: {
  prices: PlanPrice[]
  memberAction?: ReactNode
  creatorAction: ReactNode
  organizationAction: ReactNode
  unavailablePriceText?: string
}) {
  const creatorPrices = summarizePlanPrices(prices, 'creator_pro')
  const organizationPrices = summarizePlanPrices(prices, 'organization_pro')

  return (
    <section aria-label="Plans" className="grid gap-5 lg:grid-cols-3">
      <article className="flex flex-col rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)]">
        <span className="grid size-11 place-items-center rounded-xl bg-mist-50 text-ocean-700">
          <UserRound aria-hidden="true" className="size-5" />
        </span>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-muted">For everyone</p>
        <h2 className="mt-1 text-2xl font-bold text-navy-950">Sea N Shore Member</h2>
        <p className="mt-2 text-3xl font-bold text-navy-950">FREE</p>
        <FeatureList items={MEMBER_FEATURES} />
        {memberAction ? <div className="mt-auto pt-6">{memberAction}</div> : null}
      </article>

      <article className="flex flex-col rounded-[1.75rem] border border-teal-200 bg-white p-6 shadow-[var(--shadow-card)] ring-1 ring-teal-100">
        <span className="grid size-11 place-items-center rounded-xl bg-teal-50 text-teal-700">
          <Crown aria-hidden="true" className="size-5" />
        </span>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Independent creators</p>
        <h2 className="mt-1 text-2xl font-bold text-navy-950">Creator Pro</h2>
        <PriceBlock prices={creatorPrices} unavailableText={unavailablePriceText} />
        <p className="mt-3 text-sm leading-6 text-muted">For recruiters, consultants, trainers, coaches and event organizers.</p>
        <FeatureList items={CREATOR_FEATURES} />
        <div className="mt-auto pt-6">{creatorAction}</div>
      </article>

      <article className="flex flex-col rounded-[1.75rem] border border-mist-100 bg-navy-950 p-6 text-white shadow-[var(--shadow-card)]">
        <span className="grid size-11 place-items-center rounded-xl bg-white/10 text-teal-200">
          <Building2 aria-hidden="true" className="size-5" />
        </span>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-teal-200">Companies & institutions</p>
        <h2 className="mt-1 text-2xl font-bold">Organization Pro</h2>
        <PriceBlock prices={organizationPrices} dark unavailableText={unavailablePriceText} />
        <p className="mt-3 text-sm leading-6 text-white/70">
          For shipping companies, manning agencies, training institutes, colleges, survey companies, service companies and associations.
        </p>
        <div className="[&_li]:text-white/85 [&_svg]:text-teal-200">
          <FeatureList items={ORGANIZATION_FEATURES} />
        </div>
        <div className="mt-auto pt-6">{organizationAction}</div>
      </article>
    </section>
  )
}
