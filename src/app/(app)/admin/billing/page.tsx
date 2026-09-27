import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { AdminChip, AdminEmptyState, AdminFilterBar, AdminPageHeader, AdminPanel, formatAdminDate, type AdminChipTone } from '@/features/admin/components/admin-ui'
import { subscriptionChargeMode } from '@/features/billing/billing-config'
import { paymentMethodLabel } from '@/features/billing/billing-view'
import { AdminCancelSubscription, PlanPriceEditor } from '@/features/billing/components/admin-billing-controls'
import { INTERVAL_LABELS, PLAN_LABELS, PAID_PLAN_CODES, BILLING_INTERVALS, formatRupees } from '@/features/billing/plans'
import { subscriptionRepository } from '@/features/billing/subscription-repository'
import { subscriptionService } from '@/features/billing/subscription-service'
import { minorToPriceInput } from '@/features/payments/currency'

export const metadata: Metadata = { title: 'Billing · Admin' }
export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const STATUS_FILTERS = [
  { value: null, label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'past_due', label: 'Payment failed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Ended' },
] as const

const accessTone: Record<string, AdminChipTone> = { active: 'success', trialing: 'info', past_due: 'warning', cancelled: 'neutral', expired: 'neutral', pending: 'info' }
const accessLabel: Record<string, string> = { active: 'Active', trialing: 'Trial', past_due: 'Payment failed', cancelled: 'Cancelled', expired: 'Ended', pending: 'Pending' }
const paymentTone: Record<string, AdminChipTone> = { success: 'success', pending: 'info', failed: 'danger', cancelled: 'neutral' }
const paymentLabel: Record<string, string> = { success: 'Paid', pending: 'Scheduled', failed: 'Failed', cancelled: 'Cancelled' }

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Plan prices, subscriptions and subscription payments. Price changes create a new
 * price row (existing subscribers keep theirs). Plans can still be given without
 * payment from each member's or organization's Access page (entitlement grants).
 */
export default async function AdminBillingPage({ searchParams }: { searchParams?: SearchParams }) {
  try {
    await requirePlatformAdministratorUser()
  } catch (error) {
    if (error instanceof Error && error.message === 'admin_forbidden') notFound()
    throw error
  }
  const params = (await searchParams) ?? {}
  const status = first(params.status) ?? null
  const [prices, history, subscriptions, payments, configuration] = await Promise.all([
    subscriptionRepository.listActivePrices(),
    subscriptionRepository.listPriceHistory(40),
    subscriptionRepository.listSubscriptionsForAdmin({ status, limit: 100 }),
    subscriptionRepository.listRecentPaymentsForAdmin(50),
    subscriptionService.isConfigured().catch(() => ({ configured: false as const, environment: null })),
  ])
  const chargeMode = subscriptionChargeMode()

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Billing"
        description="Prices for Creator Pro and Organization Pro, every subscription and its payments. Changing a price only affects new subscribers."
        meta={`${subscriptions.length} subscription${subscriptions.length === 1 ? '' : 's'}`}
      />

      <AdminPanel className="p-4">
        <ul className="flex flex-wrap gap-2">
          <li>
            <AdminChip tone={configuration.configured ? 'success' : 'warning'}>
              {configuration.configured ? `Cashfree connected (${configuration.environment})` : 'Cashfree not set up — checkout is off'}
            </AdminChip>
          </li>
          <li><AdminChip tone="info">{chargeMode === 'merchant' ? 'Renewals raised by our billing job' : 'Renewals charged automatically by Cashfree'}</AdminChip></li>
        </ul>
      </AdminPanel>

      <AdminPanel>
        <div className="border-b border-mist-100 px-4 py-3">
          <h3 className="font-semibold text-navy-950">Prices</h3>
          <p className="text-sm text-muted">Amounts in rupees, charged every month or year until the subscriber cancels.</p>
        </div>
        <ul className="divide-y divide-mist-100">
          {PAID_PLAN_CODES.flatMap((plan) => BILLING_INTERVALS.map((interval) => {
            const price = prices.find((entry) => entry.planCode === plan && entry.interval === interval) ?? null
            const label = `${PLAN_LABELS[plan]} ${INTERVAL_LABELS[interval].adjective.toLowerCase()}`
            return (
              <li key={`${plan}-${interval}`} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0">
                  <p className="font-semibold text-navy-950">{label}</p>
                  <p className="text-sm text-navy-800">
                    {price ? `${formatRupees(price.amountMinor)} ${INTERVAL_LABELS[interval].per}` : 'No price — this option can’t be bought'}
                    {price ? <span className="text-muted"> · since {formatAdminDate(price.createdAt)}</span> : null}
                  </p>
                  {price ? (
                    <p className="text-xs text-muted">
                      {price.providerPlanId ? `Cashfree plan ${price.providerPlanId} (${price.providerEnvironment})` : 'Cashfree plan is created at the first checkout'}
                    </p>
                  ) : null}
                </div>
                <PlanPriceEditor plan={plan} interval={interval} label={label} currentRupees={price ? minorToPriceInput(price.amountMinor, 'INR') : ''} />
              </li>
            )
          }))}
        </ul>
        {history.some((price) => !price.active) ? (
          <details className="border-t border-mist-100 px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-ocean-700 hover:underline">Previous prices</summary>
            <ul className="mt-2 space-y-1 text-sm text-navy-800">
              {history.filter((price) => !price.active).map((price) => (
                <li key={price.id}>
                  {PLAN_LABELS[price.planCode]} {INTERVAL_LABELS[price.interval].adjective.toLowerCase()}: {formatRupees(price.amountMinor)} (from {formatAdminDate(price.createdAt)})
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </AdminPanel>

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold text-navy-950">Subscriptions</h3>
          <AdminFilterBar
            label="Filter subscriptions by status"
            options={STATUS_FILTERS.map((filter) => ({
              href: filter.value ? `/admin/billing?status=${filter.value}` : '/admin/billing',
              label: filter.label,
              active: (filter.value ?? null) === status,
            }))}
          />
        </div>
        <AdminPanel>
          {subscriptions.length ? (
            <ul className="divide-y divide-mist-100">
              {subscriptions.map(({ access, current, subjectName, subjectHref, checkout }) => {
                return (
                  <li key={access.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-start">
                    <div className="min-w-0">
                      <Link href={subjectHref} className="font-semibold text-ocean-700 hover:underline">{subjectName}</Link>
                      <p className="text-sm text-navy-800">
                        {PLAN_LABELS[access.planCode]}
                        {checkout ? ` · ${formatRupees(checkout.amountMinor)} ${INTERVAL_LABELS[checkout.interval].per}` : ' · given by the team'}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <AdminChip tone={accessTone[access.status] ?? 'neutral'}>{accessLabel[access.status] ?? access.status}</AdminChip>
                        {current && checkout ? <AdminChip tone={access.cancelAtPeriodEnd ? 'neutral' : 'info'}>{access.cancelAtPeriodEnd ? 'Auto-renew off' : 'Auto-renew on'}</AdminChip> : null}
                        {current && !checkout ? <AdminChip tone="neutral">No payment mandate</AdminChip> : null}
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <dt className="text-muted">Access until</dt>
                      <dd className="font-medium text-navy-950">{access.periodEndsAt ? formatAdminDate(access.periodEndsAt) : 'No end date'}</dd>
                      <dt className="text-muted">Next payment</dt>
                      <dd className="font-medium text-navy-950">{checkout && current && !access.cancelAtPeriodEnd ? formatAdminDate(checkout.nextChargeAt) : '—'}</dd>
                      <dt className="text-muted">Method</dt>
                      <dd className="font-medium text-navy-950">{checkout ? paymentMethodLabel(checkout.paymentMethod) ?? 'Mandate' : 'None'}</dd>
                      {checkout ? (
                        <>
                          <dt className="text-muted">Cashfree id</dt>
                          <dd className="break-all font-mono text-xs text-navy-900">{checkout.providerSubscriptionId}</dd>
                        </>
                      ) : null}
                    </dl>
                    <div className="lg:w-64">
                      {current ? (
                        <AdminCancelSubscription
                          accessId={access.id}
                          subjectName={subjectName}
                          planLabel={PLAN_LABELS[access.planCode]}
                          accessUntil={checkout?.paidThroughAt ? formatAdminDate(checkout.paidThroughAt) : access.periodEndsAt ? formatAdminDate(access.periodEndsAt) : null}
                        />
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <AdminEmptyState title="No subscriptions" description={status ? 'No subscription has this status.' : 'Nobody has subscribed yet.'} />
          )}
        </AdminPanel>
        <p className="text-sm text-muted">
          To give a plan without payment, open the member in{' '}
          <Link href="/admin/users" className="font-semibold text-ocean-700 hover:underline">Users</Link>
          {' '}or the organization in{' '}
          <Link href="/admin/organizations" className="font-semibold text-ocean-700 hover:underline">Organizations</Link>
          {' '}and grant the access there.
        </p>
      </section>

      <AdminPanel>
        <div className="border-b border-mist-100 px-4 py-3">
          <h3 className="font-semibold text-navy-950">Recent payments</h3>
          <p className="text-sm text-muted">Renewal charges reported by Cashfree. Refunds are made in the Cashfree dashboard.</p>
        </div>
        {payments.length ? (
          <ul className="divide-y divide-mist-100">
            {payments.map((payment) => (
              <li key={payment.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)_7rem_7rem] sm:items-center sm:gap-4">
                <span className="text-navy-900">{formatAdminDate(payment.paidAt ?? payment.createdAt)}</span>
                <span className="min-w-0">
                  <span className="font-semibold text-navy-950">{payment.subjectName}</span>
                  <span className="text-muted"> · {PLAN_LABELS[payment.planCode]} {INTERVAL_LABELS[payment.interval].adjective.toLowerCase()}{payment.paymentType === 'AUTH' ? ' · approval' : ''}</span>
                  {payment.failureReason && payment.status === 'failed' ? <span className="block text-xs text-red-700">{payment.failureReason}</span> : null}
                </span>
                <span className="font-semibold text-navy-950 sm:text-right">{formatRupees(payment.amountMinor)}</span>
                <span className="sm:justify-self-end"><AdminChip tone={paymentTone[payment.status] ?? 'neutral'}>{paymentLabel[payment.status] ?? payment.status}</AdminChip></span>
              </li>
            ))}
          </ul>
        ) : (
          <AdminEmptyState title="No payments yet" />
        )}
      </AdminPanel>
    </div>
  )
}
