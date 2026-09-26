import type { Metadata } from 'next'
import Link from 'next/link'
import { Search, ShieldCheck } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  AdminChip,
  AdminEmptyState,
  AdminFilterBar,
  AdminPageHeader,
  AdminPanel,
  formatAdminDate,
  looksLikeTestAccount,
  type AdminChipTone,
} from '@/features/admin/components/admin-ui'
import {
  ADMIN_USER_STATUSES,
  adminRepository,
  type AdminUserStatus,
  type AdminUserStatusFilter,
} from '@/features/admin/repository'
import { pluralize } from '@/lib/format'

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

const statusTone: Record<AdminUserStatus, AdminChipTone> = {
  active: 'success',
  restricted: 'warning',
  suspended: 'danger',
  deletion_requested: 'neutral',
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

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
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
  const testAccounts = viewingDeletionRecords ? 0 : users.filter(looksLikeTestAccount).length

  const filterOptions = (['all', ...ADMIN_USER_STATUSES] as AdminUserStatusFilter[]).map((item) => {
    const href = new URLSearchParams()
    if (query) href.set('q', query)
    if (item !== 'all') href.set('status', item)
    const search = href.toString()
    return { href: `/admin/users${search ? `?${search}` : ''}`, label: filterLabels[item], active: item === status }
  })

  return (
    <main className="space-y-4">
      <AdminPageHeader
        title={viewingDeletionRecords ? 'Deleted account records' : 'User accounts'}
        meta={`${pluralize(users.length, 'result')}${testAccounts ? ` · ${testAccounts} look like test accounts` : ''}`}
        description={viewingDeletionRecords
          ? 'These are not active or manageable users. They are anonymized tombstones retained only so moderation history and integrity records remain traceable.'
          : undefined}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <AdminFilterBar label="User status filters" options={filterOptions} />
        <form method="get" action="/admin/users" className="flex gap-2 lg:w-96">
          <label className="relative flex-1">
            <span className="sr-only">Search users</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              name="q"
              defaultValue={query}
              maxLength={120}
              placeholder="Name, username, headline or email"
              className="min-h-9 w-full rounded-lg border border-mist-100 bg-white py-1.5 pl-9 pr-3 text-sm text-navy-950 outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-100"
            />
          </label>
          {status !== 'all' ? <input type="hidden" name="status" value={status} /> : null}
          <button type="submit" className="min-h-9 rounded-lg bg-navy-950 px-3 text-sm font-semibold text-white hover:bg-navy-900">
            Search
          </button>
        </form>
      </div>

      <AdminPanel>
        {users.length === 0 ? (
          <AdminEmptyState title="No users match this view." description="Try a different search term or account-status filter." />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[44rem] table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[38%]" />
                <col className="w-[24%]" />
                <col className="w-[11%]" />
                <col className="w-[12%]" />
                <col className="w-[15%]" />
              </colgroup>
              <thead className="border-b border-mist-100 bg-mist-50/70 text-xs font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5">Member</th>
                  <th scope="col" className="px-4 py-2.5">Email</th>
                  <th scope="col" className="px-4 py-2.5">Status</th>
                  <th scope="col" className="px-4 py-2.5">Joined</th>
                  <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mist-100">
                {users.map((user) => {
                  const deleted = user.status === 'deletion_requested'
                  const isTest = !deleted && looksLikeTestAccount(user)
                  return (
                    <tr key={user.id} className="align-middle transition hover:bg-mist-50/60">
                      <td className="px-4 py-2.5">
                        <div className="flex min-w-0 items-center gap-3">
                          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-mist-100 text-[11px] font-bold text-navy-950">
                            {initials(user.fullName)}
                          </span>
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-1.5 font-semibold text-navy-950">
                              <Link href={`/admin/users/${user.id}`} className="truncate hover:text-ocean-700 hover:underline">{user.fullName}</Link>
                              {user.isAdministrator ? (
                                <span title="Administrator" className="inline-flex items-center gap-1 text-xs font-semibold text-ocean-700">
                                  <ShieldCheck aria-hidden="true" className="size-3.5" /> Admin
                                </span>
                              ) : null}
                              {isTest ? <AdminChip tone="warning">Test account</AdminChip> : null}
                            </p>
                            <p className="truncate text-xs text-muted">
                              {deleted ? 'Personal account data removed · audit tombstone only' : [user.slug ? `@${user.slug}` : null, user.headline].filter(Boolean).join(' · ') || '—'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="truncate px-4 py-2.5 text-navy-900" title={user.email ?? undefined}>{user.email ?? (deleted ? '—' : 'No email retained')}</td>
                      <td className="px-4 py-2.5"><AdminChip tone={statusTone[user.status]}>{statusLabels[user.status]}</AdminChip></td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted">{formatAdminDate(user.createdAt)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/admin/users/${user.id}`}
                          className="inline-flex min-h-8 items-center whitespace-nowrap rounded-lg border border-mist-100 px-3 text-xs font-semibold text-navy-950 transition hover:border-ocean-200 hover:bg-ocean-50"
                        >
                          {deleted ? 'View deletion record' : 'Manage user'}
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminPanel>
    </main>
  )
}
