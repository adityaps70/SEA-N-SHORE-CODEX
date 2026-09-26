import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { ArrowLeft, Mail, ShieldCheck } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { capabilityLabel } from '@/features/access/capability-labels'
import { AdminChip, formatAdminDate, looksLikeTestAccount, type AdminChipTone } from '@/features/admin/components/admin-ui'
import { AdminUserControlPanel } from '@/features/admin/components/admin-user-control-panel'
import { AdminEntitlementControlPanel } from '@/features/admin/components/admin-entitlement-control-panel'
import { adminMembershipRepository } from '@/features/admin/membership-repository'
import { adminRepository, type AdminUserStatus } from '@/features/admin/repository'

export const metadata: Metadata = { title: 'User account · Admin' }

function statusLabel(status: AdminUserStatus) {
  if (status === 'deletion_requested') return 'Deleted'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

const statusTone: Record<AdminUserStatus, AdminChipTone> = {
  active: 'success',
  restricted: 'warning',
  suspended: 'danger',
  deletion_requested: 'neutral',
}

function humanize(value: string) {
  const text = value.replaceAll('_', ' ').replaceAll('.', ' ').trim()
  return text ? text[0].toUpperCase() + text.slice(1) : text
}

function planLabel(plan: string | null | undefined) {
  if (plan === 'creator_pro') return 'Creator Pro'
  if (plan === 'organization_pro') return 'Organization Pro'
  return 'Sea N Shore Member · Free'
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-mist-100 bg-white p-5">
      <h3 className="text-base font-bold text-navy-950">{title}</h3>
      {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-semibold text-navy-950">{children}</dd>
    </div>
  )
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

  const isTest = looksLikeTestAccount(user)

  return (
    <main className="space-y-4">
      <Link href="/admin/users" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-navy-950">
        <ArrowLeft aria-hidden="true" className="size-4" /> User accounts
      </Link>

      <div className="grid gap-4 xl:grid-cols-[20rem_minmax(0,1fr)] xl:items-start">
        <aside className="space-y-4 xl:sticky xl:top-24">
          <section className="rounded-xl border border-mist-100 bg-white p-5">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-navy-950 text-sm font-bold text-white">
                {initials(user.fullName)}
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold text-navy-950">{user.fullName}</h2>
                <p className="truncate text-sm text-muted">{user.slug ? `@${user.slug}` : 'No public username'}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <AdminChip tone={statusTone[user.status]}>{statusLabel(user.status)}</AdminChip>
              {user.isAdministrator ? (
                <AdminChip tone="info"><ShieldCheck aria-hidden="true" className="mr-1 size-3.5" /> Administrator</AdminChip>
              ) : null}
              {isTest ? <AdminChip tone="warning">Test account</AdminChip> : null}
            </div>
            {user.headline ? <p className="mt-3 text-sm text-navy-900">{user.headline}</p> : null}

            <dl className="mt-4 divide-y divide-mist-100 border-t border-mist-100">
              <Fact label="Email">
                <span className="inline-flex items-center gap-1.5 break-all"><Mail aria-hidden="true" className="size-3.5 shrink-0 text-muted" />{user.email ?? 'Not retained'}</span>
              </Fact>
              <Fact label="Account status">{statusLabel(user.status)}</Fact>
              <Fact label="Joined">{formatAdminDate(user.createdAt)}</Fact>
              <Fact label="Last profile update">{formatAdminDate(user.updatedAt)}</Fact>
              <Fact label="Persona">{membership.persona ? humanize(membership.persona) : 'Not recorded'}</Fact>
              <Fact label="Current plan">{planLabel(membership.plan)}</Fact>
            </dl>

            {user.slug && user.status === 'active' ? (
              <Link href={`/people/${user.slug}`} className="mt-4 inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-mist-100 text-sm font-semibold text-navy-950 hover:bg-mist-50">
                View profile
              </Link>
            ) : null}
          </section>
        </aside>

        <div className="min-w-0 space-y-4">
          <Section title="Access & plan" description="What this member can do right now, and why.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-muted">Effective capabilities</p>
                <ul className="mt-2 space-y-1">
                  {membership.effectiveCapabilities.length ? membership.effectiveCapabilities.map((capability) => (
                    <li key={capability} className="flex items-center gap-2 text-sm text-navy-950">
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-600" />
                      {capabilityLabel(capability)}
                    </li>
                  )) : (
                    <li className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
                      No effective capabilities. Account status overrides plans and grants.
                    </li>
                  )}
                </ul>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-semibold text-muted">Subscription</p>
                  {membership.subscription ? (
                    <div className="mt-1 text-sm leading-6 text-navy-900">
                      <p><span className="font-semibold">{humanize(membership.subscription.status)}</span>{membership.subscription.cancelAtPeriodEnd ? ' · Cancels at period end' : ''}</p>
                      <p className="text-muted">
                        {membership.subscription.currentPeriodEndsAt
                          ? `Current period ends ${formatAdminDate(membership.subscription.currentPeriodEndsAt)}`
                          : 'No billing period end recorded'}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-muted">No paid subscription. Free membership applies unless an override is active.</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted">Profile intents</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {membership.intents.length ? membership.intents.map((intent) => (
                      <AdminChip key={intent}>{humanize(intent)}</AdminChip>
                    )) : <span className="text-sm text-muted">None recorded.</span>}
                  </div>
                </div>
              </div>
            </div>
          </Section>

          <Section title="Professional verifications">
            <ul className="divide-y divide-mist-100">
              {membership.verifications.map((verification) => (
                <li key={verification.type} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-navy-950">{humanize(verification.type)}</p>
                    <AdminChip tone={verification.status === 'approved' ? 'success' : verification.status === 'rejected' || verification.status === 'suspended' ? 'danger' : 'warning'}>
                      {humanize(verification.status)}
                    </AdminChip>
                    <span className="text-xs text-muted">{humanize(verification.source)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    Submitted {verification.submittedAt ? formatAdminDate(verification.submittedAt) : 'not recorded'}
                    {verification.reviewedAt ? ` · Reviewed ${formatAdminDate(verification.reviewedAt)}` : ''}
                  </p>
                  {verification.reviewNote ? <p className="mt-1.5 rounded-lg bg-mist-50 px-3 py-2 text-sm text-navy-900">{verification.reviewNote}</p> : null}
                </li>
              ))}
              {membership.verifications.length === 0 ? <li className="text-sm text-muted">No professional verification records.</li> : null}
            </ul>
            <details className="mt-4 border-t border-mist-100 pt-3">
              <summary className="cursor-pointer text-sm font-semibold text-navy-950">Verification history ({membership.verificationHistory.length})</summary>
              <ul className="mt-2 divide-y divide-mist-100">
                {membership.verificationHistory.map((event) => (
                  <li key={event.id} className="py-2 text-sm">
                    <span className="font-semibold text-navy-950">{humanize(event.action)}</span>
                    {event.verificationType ? <span className="text-muted"> · {humanize(event.verificationType)}</span> : null}
                    <span className="block text-xs text-muted">{event.actor ? `By ${event.actor.fullName} · ` : ''}{formatAdminDate(event.createdAt, true)}</span>
                  </li>
                ))}
                {membership.verificationHistory.length === 0 ? <li className="py-2 text-sm text-muted">No verification audit events recorded for this user.</li> : null}
              </ul>
            </details>
            <Link href="/admin/verifications" className="mt-3 inline-flex text-sm font-semibold text-ocean-700 hover:underline">Open verification queue →</Link>
          </Section>

          {/* Entitlement history and manual overrides */}
          <AdminEntitlementControlPanel
            subjectType="profile"
            subjectId={user.id}
            entitlementHistory={membership.entitlementHistory}
          />

          <Section title="Account action history">
            <ul className="divide-y divide-mist-100">
              {history.map((event) => {
                const reason = typeof event.metadata.reason === 'string' ? event.metadata.reason : null
                const previousStatus = typeof event.metadata.previousStatus === 'string' ? event.metadata.previousStatus : null
                const nextStatus = typeof event.metadata.nextStatus === 'string' ? event.metadata.nextStatus : null
                return (
                  <li key={event.id} className="grid gap-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
                    <div className="min-w-0 text-sm">
                      <p className="font-semibold text-navy-950">{humanize(event.action)}</p>
                      <p className="text-muted">
                        By <span className="font-semibold text-navy-900">{event.actor.fullName}</span>
                        {previousStatus && nextStatus ? ` · ${humanize(previousStatus)} → ${humanize(nextStatus)}` : ''}
                      </p>
                      {reason ? <p className="mt-1 rounded-lg bg-mist-50 px-3 py-2 text-navy-950">{reason}</p> : null}
                    </div>
                    <time dateTime={event.createdAt} className="text-xs text-muted">{formatAdminDate(event.createdAt, true)}</time>
                  </li>
                )
              })}
              {history.length === 0 ? (
                <li className="text-sm text-muted">No suspension, restoration or permanent-deletion actions have been recorded for this account.</li>
              ) : null}
            </ul>
          </Section>

          <AdminUserControlPanel
            profileId={user.id}
            status={user.status}
            isAdministrator={user.isAdministrator}
          />
        </div>
      </div>
    </main>
  )
}
