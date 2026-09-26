import type { Metadata } from 'next'
import Link from 'next/link'
import { Search, ShieldAlert, UserRound } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  ADMIN_USER_STATUSES,
  adminRepository,
  type AdminUserStatus,
  type AdminUserStatusFilter,
} from '@/features/admin/repository'

export const metadata: Metadata = { title: 'Users · Admin' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const statusLabels: Record<AdminUserStatusFilter, string> = {
  all: 'All users',
  active: 'Active',
  restricted: 'Restricted',
  suspended: 'Suspended',
  deletion_requested: 'Deleted',
}

const filterLabels: Record<AdminUserStatusFilter, string> = {
  ...statusLabels,
  deletion_requested: 'Deletion records',
}

function readSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function readStatus(value: string | string[] | undefined): AdminUserStatusFilter {
  const candidate = readSingle(value)
  return candidate === 'all' || ADMIN_USER_STATUSES.includes(candidate as AdminUserStatus)
    ? candidate as AdminUserStatusFilter
    : 'all'
}

function statusClass(status: AdminUserStatus) {
  if (status === 'active') return 'bg-emerald-50 text-emerald-800'
  if (status === 'suspended') return 'bg-red-50 text-red-800'
  if (status === 'restricted') return 'bg-amber-50 text-amber-800'
  return 'bg-mist-100 text-muted'
}

export default async function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const query = readSingle(params.q).trim().slice(0, 120)
  const status = readStatus(params.status)
  const admin = await requireAwsUser()
  const users = await adminRepository.searchUsers(admin.id, {
    query,
    status,
    limit: 100,
  })

  const viewingDeletionRecords = status === 'deletion_requested'

  return (
    <main className="space-y-5">
      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-700">User safety</p>
            <h2 className="mt-1 text-2xl font-bold text-navy-950">
              {viewingDeletionRecords ? 'Deleted account records' : 'User accounts'}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              {viewingDeletionRecords
                ? 'These are not active or manageable users. They are anonymized tombstones retained only so moderation history and integrity records remain traceable.'
                : 'Search members, review account status and moderation history, then suspend, restore or permanently delete accounts where appropriate.'}
            </p>
          </div>
          <div className="rounded-xl bg-mist-50 px-3 py-2 text-sm font-semibold text-muted">
            {users.length} result{users.length === 1 ? '' : 's'}
          </div>
        </div>

        <form method="get" action="/admin/users" className="mt-5 flex flex-col gap-2 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Search users</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              name="q"
              defaultValue={query}
              maxLength={120}
              placeholder="Search name, username, headline or email"
              className="min-h-11 w-full rounded-xl border border-mist-100 bg-white py-2 pl-10 pr-3 text-sm text-navy-950 outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-100"
            />
          </label>
          {status !== 'all' ? <input type="hidden" name="status" value={status} /> : null}
          <button type="submit" className="min-h-11 rounded-xl bg-navy-950 px-5 text-sm font-bold text-white hover:bg-navy-900">
            Search users
          </button>
        </form>

        <nav aria-label="User status filters" className="mt-4 flex flex-wrap gap-2">
          {(['all', ...ADMIN_USER_STATUSES] as AdminUserStatusFilter[]).map((item) => {
            const href = new URLSearchParams()
            if (query) href.set('q', query)
            if (item !== 'all') href.set('status', item)
            const search = href.toString()
            return (
              <Link
                key={item}
                href={`/admin/users${search ? `?${search}` : ''}`}
                className={`rounded-full px-3.5 py-2 text-sm font-bold transition ${
                  item === status ? 'bg-navy-950 text-white' : 'bg-mist-50 text-navy-900 hover:bg-mist-100'
                }`}
              >
                {filterLabels[item]}
              </Link>
            )
          })}
        </nav>
      </section>

      <section className="overflow-hidden rounded-[1.5rem] border border-mist-100 bg-white shadow-[var(--shadow-card)]">
        <div className="divide-y divide-mist-100">
          {users.map((user) => (
            <article key={user.id} className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-mist-50 text-navy-950">
                    {user.isAdministrator
                      ? <ShieldAlert aria-hidden="true" className="size-4" />
                      : <UserRound aria-hidden="true" className="size-4" />}
                  </span>
                  <h3 className="truncate text-lg font-bold text-navy-950">{user.fullName}</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(user.status)}`}>
                    {statusLabels[user.status]}
                  </span>
                  {user.isAdministrator ? (
                    <span className="rounded-full bg-ocean-50 px-2.5 py-1 text-xs font-bold text-ocean-800">Administrator</span>
                  ) : null}
                </div>
                <p className="mt-2 truncate text-sm text-muted">
                  {user.status === 'deletion_requested'
                    ? 'Personal account data removed · audit tombstone only'
                    : (
                      <>
                        {user.email ?? 'No email retained'}
                        {user.slug ? ` · @${user.slug}` : ''}
                        {user.headline ? ` · ${user.headline}` : ''}
                      </>
                    )}
                </p>
              </div>
              <Link
                href={`/admin/users/${user.id}`}
                className="inline-flex min-h-10 items-center justify-center rounded-xl bg-navy-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-navy-900"
              >
                {user.status === 'deletion_requested' ? 'View deletion record' : 'Manage user'}
              </Link>
            </article>
          ))}
          {users.length === 0 ? (
            <div className="p-10 text-center">
              <p className="font-bold text-navy-950">No users match this view.</p>
              <p className="mt-1 text-sm text-muted">Try a different search term or account-status filter.</p>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}
