import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { FileClock, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { AdminUserControlPanel } from '@/features/admin/components/admin-user-control-panel'
import { AdminEntitlementControlPanel } from '@/features/admin/components/admin-entitlement-control-panel'
import { adminMembershipRepository } from '@/features/admin/membership-repository'
import { adminRepository, type AdminUserStatus } from '@/features/admin/repository'

function statusLabel(status: AdminUserStatus) {
  if (status === 'deletion_requested') return 'Deleted'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function statusClass(status: AdminUserStatus) {
  if (status === 'active') return 'bg-emerald-50 text-emerald-800'
  if (status === 'suspended') return 'bg-red-50 text-red-800'
  if (status === 'restricted') return 'bg-amber-50 text-amber-800'
  return 'bg-mist-100 text-muted'
}

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ profileId: string }>
}) {
  const { profileId } = await params
  if (!z.string().uuid().safeParse(profileId).success) notFound()

  const admin = await requireAwsUser()
  const [user, history, membership] = await Promise.all([
    adminRepository.getAdminUser(admin.id, profileId),
    adminRepository.listUserAccountHistory(admin.id, profileId, 100),
    adminMembershipRepository.getUserAccessOverview(admin.id, profileId),
  ])
  if (!user || !membership) notFound()

  return (
    <main className="space-y-5">
      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <Link href="/admin/users" className="text-sm font-bold text-muted hover:text-navy-950">← User accounts</Link>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="grid size-10 place-items-center rounded-xl bg-mist-50 text-navy-950">
                <UserRound aria-hidden="true" className="size-5" />
              </span>
              <h2 className="truncate text-2xl font-bold text-navy-950">{user.fullName}</h2>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(user.status)}`}>
                {statusLabel(user.status)}
              </span>
              {user.isAdministrator ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-ocean-50 px-2.5 py-1 text-xs font-bold text-ocean-800">
                  <ShieldCheck aria-hidden="true" className="size-3.5" /> Administrator
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-sm text-muted">
              {user.slug ? `@${user.slug}` : 'No public username'}
              {user.headline ? ` · ${user.headline}` : ''}
            </p>
          </div>
          {user.slug && user.status === 'active' ? (
            <Link href={`/people/${user.slug}`} className="inline-flex min-h-10 items-center rounded-xl border border-mist-100 px-4 text-sm font-bold text-navy-950 hover:bg-mist-50">
              View profile
            </Link>
          ) : null}
        </div>

        <dl className="mt-6 grid gap-4 border-t border-mist-100 pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Email</dt>
            <dd className="mt-1 flex items-center gap-2 text-sm font-semibold text-navy-950">
              <Mail aria-hidden="true" className="size-4 text-muted" />
              {user.email ?? 'Not retained'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Account status</dt>
            <dd className="mt-1 text-sm font-semibold text-navy-950">{statusLabel(user.status)}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Joined</dt>
            <dd className="mt-1 text-sm font-semibold text-navy-950">{dateLabel(user.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Last profile update</dt>
            <dd className="mt-1 text-sm font-semibold text-navy-950">{dateLabel(user.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <article className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Membership context</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">Persona, plan & access</h2>

          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Persona</dt>
              <dd className="mt-1 text-sm font-semibold text-navy-950">{membership.persona?.replaceAll('_', ' ') ?? 'Not backfilled'}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Current plan</dt>
              <dd className="mt-1 text-sm font-semibold text-navy-950">
                {membership.plan === 'creator_pro' ? 'Creator Pro' : membership.plan === 'organization_pro' ? 'Organization Pro' : 'Sea N Shore Member · Free'}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Profile intents</dt>
              <dd className="mt-2 flex flex-wrap gap-2">
                {membership.intents.length ? membership.intents.map((intent) => (
                  <span key={intent} className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-semibold text-navy-900">{intent.replaceAll('_', ' ')}</span>
                )) : <span className="text-sm text-muted">No persona intents recorded.</span>}
              </dd>
            </div>
          </dl>

          <div className="mt-5 border-t border-mist-100 pt-5">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Subscription</p>
            {membership.subscription ? (
              <div className="mt-2 text-sm leading-6 text-navy-900">
                <p><span className="font-semibold capitalize">{membership.subscription.status.replaceAll('_', ' ')}</span>{membership.subscription.cancelAtPeriodEnd ? ' · Cancels at period end' : ''}</p>
                <p className="text-muted">
                  {membership.subscription.currentPeriodEndsAt
                    ? `Current period ends ${dateLabel(membership.subscription.currentPeriodEndsAt)}`
                    : 'No billing period end recorded'}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">No paid subscription record. Free membership applies unless an explicit entitlement is active.</p>
            )}
          </div>

          <div className="mt-5 border-t border-mist-100 pt-5">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Effective capabilities</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {membership.effectiveCapabilities.length ? membership.effectiveCapabilities.map((capability) => (
                <span key={capability} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">{capability}</span>
              )) : (
                <span className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
                  No effective capabilities. Account status overrides plans and grants.
                </span>
              )}
            </div>
          </div>
        </article>

        <article className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Professional trust</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">Professional verifications</h2>
          <div className="mt-5 divide-y divide-mist-100">
            {membership.verifications.map((verification) => (
              <div key={verification.type} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-bold capitalize text-navy-950">{verification.type.replaceAll('_', ' ')}</p>
                  <span className="rounded-full bg-mist-50 px-2 py-0.5 text-[11px] font-bold capitalize text-muted">{verification.status}</span>
                  <span className="rounded-full bg-ocean-50 px-2 py-0.5 text-[11px] font-semibold text-ocean-800">{verification.source.replaceAll('_', ' ')}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Submitted {verification.submittedAt ? dateLabel(verification.submittedAt) : 'not recorded'}
                  {verification.reviewedAt ? ` · Reviewed ${dateLabel(verification.reviewedAt)}` : ''}
                </p>
                {verification.reviewNote ? <p className="mt-2 rounded-xl bg-mist-50 px-3 py-2 text-sm text-navy-900">{verification.reviewNote}</p> : null}
              </div>
            ))}
            {membership.verifications.length === 0 ? <p className="py-4 text-sm text-muted">No professional verification records.</p> : null}
          </div>
          <Link href="/admin/verifications" className="mt-5 inline-flex text-sm font-bold text-ocean-700 hover:underline">Open verification queue →</Link>
        </article>
      </section>

      <div>
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-red-700">Entitlement history & controls</p>
        <AdminEntitlementControlPanel
          subjectType="profile"
          subjectId={user.id}
          entitlementHistory={membership.entitlementHistory}
        />
      </div>

      <AdminUserControlPanel
        profileId={user.id}
        status={user.status}
        isAdministrator={user.isAdministrator}
      />

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-mist-50 text-navy-950">
            <FileClock aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-ocean-700">Moderation history</p>
            <h2 className="text-xl font-bold text-navy-950">Account action history</h2>
          </div>
        </div>

        <div className="mt-5 divide-y divide-mist-100">
          {history.map((event) => {
            const reason = typeof event.metadata.reason === 'string' ? event.metadata.reason : null
            const previousStatus = typeof event.metadata.previousStatus === 'string' ? event.metadata.previousStatus : null
            const nextStatus = typeof event.metadata.nextStatus === 'string' ? event.metadata.nextStatus : null
            return (
              <article key={event.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-bold text-navy-950">{event.action.replaceAll('.', ' ')}</p>
                    <p className="mt-1 text-sm text-muted">
                      By <span className="font-semibold text-navy-900">{event.actor.fullName}</span>
                      {previousStatus && nextStatus ? ` · ${previousStatus} → ${nextStatus}` : ''}
                    </p>
                    {reason ? (
                      <p className="mt-2 rounded-xl bg-mist-50 px-3 py-2 text-sm leading-6 text-navy-950">
                        {reason}
                      </p>
                    ) : null}
                  </div>
                  <time dateTime={event.createdAt} className="shrink-0 text-xs font-medium text-muted">
                    {dateLabel(event.createdAt)}
                  </time>
                </div>
              </article>
            )
          })}
          {history.length === 0 ? (
            <p className="py-5 text-sm text-muted">No suspension, restoration or permanent-deletion actions have been recorded for this account.</p>
          ) : null}
        </div>
      </section>
    </main>
  )
}
