import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { FileClock, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { AdminUserControlPanel } from '@/features/admin/components/admin-user-control-panel'
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
  const [user, history] = await Promise.all([
    adminRepository.getAdminUser(admin.id, profileId),
    adminRepository.listUserAccountHistory(admin.id, profileId, 100),
  ])
  if (!user) notFound()

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
