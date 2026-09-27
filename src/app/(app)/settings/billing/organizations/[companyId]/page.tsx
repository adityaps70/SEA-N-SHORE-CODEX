import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { ShieldCheck } from 'lucide-react'
import { canUseCapability } from '@/features/access/policy'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { canManageOrganizationBilling } from '@/features/billing/billing-access'
import { BillingHistory, CheckoutNotice, PlanBillingPanel } from '@/features/billing/components/plan-billing-panel'
import { loadCheckoutNotice, loadPlanBillingView } from '@/features/billing/page-data'
import { billingRepository } from '@/features/billing/repository'

export const metadata: Metadata = { title: 'Organization billing · Settings' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Organization Pro for one workspace. Only its approved owner or administrators can see
 * this page and buy, cancel or change the plan (checked again in every server action).
 */
export default async function OrganizationBillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>
  searchParams?: SearchParams
}) {
  const { companyId } = await params
  if (!z.string().uuid().safeParse(companyId).success) notFound()

  const user = await requireAwsUser()
  const access = await getAccessContext(user.id)
  // billing.manage comes with Organization Pro; owners and administrators of a free
  // organization must also be able to reach this page to buy it.
  if (!canManageOrganizationBilling(access, companyId) && !canUseCapability(access, 'billing.manage', { companyId })) notFound()

  const billing = await billingRepository.getOrganizationBillingOverview(companyId)
  if (!billing) notFound()

  const query = (await searchParams) ?? {}
  const subject = { kind: 'company' as const, companyId }
  const [view, checkoutNotice] = await Promise.all([
    loadPlanBillingView(subject),
    loadCheckoutNotice(first(query.checkout), subject),
  ])
  const canBuy = canManageOrganizationBilling(access, companyId)
  const blockedMessage = !canBuy
    ? 'Only the organization’s owner or an administrator can buy or change this plan.'
    : !billing.company.verified
      ? 'Organization Pro can be bought once Sea N Shore has verified this organization, because its features only work for verified organizations.'
      : null

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 py-2 sm:py-5">
      <header>
        <Link href="/settings/billing" className="text-sm font-bold text-ocean-700 underline-offset-2 transition-colors hover:text-navy-950 hover:underline">
          ← Membership & billing
        </Link>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Organization billing</p>
            <h1 className="mt-1 break-words text-3xl font-semibold tracking-tight text-navy-950">{billing.company.name}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              Organization Pro for this workspace, renewing automatically through our payment provider, Cashfree. Only the owner and administrators can manage it.
            </p>
          </div>
          <span className={`w-fit shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${
            billing.company.verified ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'
          }`}>
            {billing.company.verified ? 'Verified organization' : 'Organization verification required'}
          </span>
        </div>
      </header>

      {checkoutNotice ? <CheckoutNotice notice={checkoutNotice.notice} checkoutId={checkoutNotice.checkoutId} /> : null}

      <PlanBillingPanel
        view={view}
        target={{ kind: 'organization', companyId }}
        eyebrow="Organization plan"
        description="Organization Pro unlocks the organization page, jobs, events and courses, multiple admins, applicant and student management, analytics, branding and team permissions."
        blockedMessage={blockedMessage}
        noticeCheckoutId={checkoutNotice?.checkoutId ?? null}
        anchorId="organization-pro"
        highlight={first(query.plan) === 'organization_pro'}
      />

      {view.history.length ? <BillingHistory rows={view.history} /> : null}

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex gap-3">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-800" />
          <div>
            <h2 className="font-bold text-amber-950">Payment does not replace verification</h2>
            <p className="mt-1 text-sm leading-6 text-amber-900">
              Organization Pro unlocks features for a verified organization. Members still use them through their approved workspace role.
            </p>
            <Link href="/plans" className="mt-3 inline-flex text-sm font-bold text-amber-950 hover:underline">
              Compare plan capabilities →
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}
