import Link from 'next/link'
import type { PlanCode } from '@/features/access/policy'
import { organizationPlanBillingHref } from '../organization-page-profile'

const buttonClass = 'inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500'

/**
 * The next step under a locked Organization Pro tool. Owners and administrators go
 * straight to the organization's Plan & billing; other members are told who can upgrade.
 */
export function OrganizationUpgradeAction({
  slug,
  canBuy,
  plan,
  verified,
  className = 'mt-4',
}: {
  slug: string
  /** Owner or administrator (they buy and manage Organization Pro). */
  canBuy: boolean
  plan: PlanCode
  verified: boolean
  className?: string
}) {
  const pro = plan === 'organization_pro'
  if (canBuy) {
    if (!pro && !verified) {
      return (
        <p className={`${className} text-sm leading-6 text-amber-950`}>
          Organization Pro can be bought once Sea N Shore verifies this organization.{' '}
          <Link href={organizationPlanBillingHref(slug)} className="font-bold text-ocean-700 underline-offset-2 hover:underline">See Plan & billing</Link>
        </p>
      )
    }
    return (
      <Link href={organizationPlanBillingHref(slug)} className={`${className} ${buttonClass}`}>
        {pro ? 'See Plan & billing' : 'Upgrade to Organization Pro'}
      </Link>
    )
  }
  return (
    <p className={`${className} text-sm font-semibold leading-6 text-amber-950`}>
      {pro
        ? 'Ask an owner or administrator of this organization to change your role.'
        : 'Ask an owner or administrator to upgrade to Organization Pro.'}
    </p>
  )
}
