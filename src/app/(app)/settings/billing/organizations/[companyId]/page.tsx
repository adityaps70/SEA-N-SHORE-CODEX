import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { Building2, CalendarClock, CreditCard, ShieldCheck } from 'lucide-react'
import { CapabilityRequiredError, requireCapability } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { billingRepository } from '@/features/billing/repository'

function dateLabel(value: string | null) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function statusLabel(value: string) {
  return value.replaceAll('_', ' ').replace(/w/g, (letter) => letter.toUpperCase())
}

export default async function OrganizationBillingPage({
  params,
}: {
  params: Promise<{ companyId: string }>
}) {
  const { companyId } = await params
  if (!z.string().uuid().safeParse(companyId).success) notFound()

  const user = await requireAwsUser()
  try {
    await requireCapability(user.id, 'billing.manage', { companyId })
  } catch (error) {
    if (error instanceof CapabilityRequiredError) notFound()
    throw error
  }

  const billing = await billingRepository.getOrganizationBillingOverview(companyId)
  if (!billing) notFound()

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 py-2 sm:py-5">
      <header>
        <Link href="/settings/billing" className="text-sm font-bold text-muted hover:text-navy-950">
          ← Membership & billing
        </Link>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Organization billing</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-navy-950">{billing.company.name}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              Review the provider-neutral subscription record for this workspace. Billing access is limited to authorized organization managers.
            </p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${
            billing.company.verified ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'
          }`}>
            {billing.company.verified ? 'Verified organization' : 'Organization verification required'}
          </span>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
          <span className="grid size-10 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
            <Building2 aria-hidden="true" className="size-5" />
          </span>
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.14em] text-muted">Current organization plan</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">
            {billing.currentPlan === 'organization_pro' ? 'Organization Pro' : 'Sea N Shore Member — FREE'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Organization plan access belongs to the workspace. Individual members receive capabilities through their approved organization role.
          </p>
        </article>

        <article className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
          <span className="grid size-10 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
            <CreditCard aria-hidden="true" className="size-5" />
          </span>
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.14em] text-muted">Subscription status</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">
            {billing.subscription ? statusLabel(billing.subscription.status) : 'No subscription record'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Billing provider: {billing.subscription?.billingProvider ?? 'Not configured'}
          </p>
        </article>
      </section>

      <section className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-mist-50 text-ocean-700">
            <CalendarClock aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-navy-950">Subscription record</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              This page intentionally exposes only the operational subscription state needed by an organization billing manager.
            </p>
          </div>
        </div>

        {billing.subscription ? (
          <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Subscription status</dt>
              <dd className="mt-1 text-sm font-semibold text-navy-950">{statusLabel(billing.subscription.status)}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Plan record</dt>
              <dd className="mt-1 text-sm font-semibold text-navy-950">
                {billing.subscription.plan === 'organization_pro' ? 'Organization Pro' : 'Free'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Period started</dt>
              <dd className="mt-1 text-sm font-semibold text-navy-950">{dateLabel(billing.subscription.currentPeriodStartedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Period ends</dt>
              <dd className="mt-1 text-sm font-semibold text-navy-950">{dateLabel(billing.subscription.currentPeriodEndsAt)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Cancellation</dt>
              <dd className="mt-1 text-sm font-semibold text-navy-950">
                {billing.subscription.cancelAtPeriodEnd ? 'Scheduled to cancel at period end' : 'No cancellation scheduled'}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Billing provider</dt>
              <dd className="mt-1 text-sm font-semibold text-navy-950">{billing.subscription.billingProvider ?? 'Not configured'}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-5 rounded-xl bg-mist-50 px-4 py-3 text-sm text-muted">
            No organization subscription has been recorded yet.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex gap-3">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-800" />
          <div>
            <h2 className="font-bold text-amber-950">Checkout is not enabled</h2>
            <p className="mt-1 text-sm leading-6 text-amber-900">
              Organization checkout is not enabled until Sea N Shore approves plan pricing, currency/tax behavior and a payment provider. No payment action or invented price is shown here.
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
