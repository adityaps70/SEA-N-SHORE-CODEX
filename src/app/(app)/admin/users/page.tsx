import type { Metadata } from 'next'
import Link from 'next/link'
import { ExternalLink, Search, ShieldCheck, UserCog } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { withAdminAvatarUrls } from '@/features/admin/avatars'
import {
  AdminAvatar,
  AdminChip,
  AdminEmptyState,
  AdminFilterBar,
  AdminPageHeader,
  AdminPagination,
  AdminPanel,
  formatAdminDate,
  looksLikeTestAccount,
  readAdminPage,
  type AdminChipTone,
} from '@/features/admin/components/admin-ui'
import { ADMIN_TABLE_DESKTOP_CLASS, AdminMobileCard, AdminMobileList } from '@/features/admin/components/admin-mobile-list'
import {
  ADMIN_USER_STATUSES,
  adminRepository,
  type AdminUserStatus,
  type AdminUserStatusFilter,
} from '@/features/admin/repository'
import { pluralize } from '@/lib/format'

export const metadata: Metadata = { title: 'Users · Admin' }

/** Shared with the organizations directory so both admin lists page the same way. */
const PAGE_SIZE = 50

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

export default async function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const query = readSingle(params.q).trim().slice(0, 120)
  const status = readStatus(params.status)
  const admin = await requireAwsUser()
  const hideTestAccounts = readSingle(params.test) === 'hide'
  const page = readAdminPage(params.page)
  // One extra row tells us whether there is a next page.
  const fetched = await adminRepository.searchUsers(admin.id, {
    query,
    status,
    limit: PAGE_SIZE + 1,
    offset: (page - 1) * PAGE_SIZE,
  })
  const hasNextPage = fetched.length > PAGE_SIZE
  const results = fetched.slice(0, PAGE_SIZE)

  const viewingDeletionRecords = status === 'deletion_requested'
  const testAccounts = viewingDeletionRecords ? 0 : results.filter(looksLikeTestAccount).length
  const users = await withAdminAvatarUrls(
    hideTestAccounts && !viewingDeletionRecords ? results.filter((user) => !looksLikeTestAccount(user)) : results,
  )

  function usersHref(next: { status?: AdminUserStatusFilter; hideTest?: boolean; page?: number }) {
    const search = new URLSearchParams()
    if (query) search.set('q', query)
    const nextStatus = next.status ?? status
    if (nextStatus !== 'all') search.set('status', nextStatus)
    if (next.hideTest ?? hideTestAccounts) search.set('test', 'hide')
    // Changing a filter starts again from the first page.
    if (next.page && next.page > 1) search.set('page', String(next.page))
    const value = search.toString()
    return `/admin/users${value ? `?${value}` : ''}`
  }

  const resultsLabel = page > 1 || hasNextPage
    ? `${pluralize(users.length, 'result')} on page ${page}`
    : pluralize(users.length, 'result')

  const filterOptions = (['all', ...ADMIN_USER_STATUSES] as AdminUserStatusFilter[]).map((item) => ({
    href: usersHref({ status: item }),
    label: filterLabels[item],
    active: item === status,
  }))

  return (
    <main className="space-y-4">
      <AdminPageHeader
        title={viewingDeletionRecords ? 'Deleted account records' : 'User accounts'}
        meta={(
          <>
            {hideTestAccounts && testAccounts
              ? `${resultsLabel} · ${pluralize(testAccounts, 'test account')} hidden · `
              : `${resultsLabel}${testAccounts ? ` · ${testAccounts} look like test accounts · ` : ''}`}
            {testAccounts ? (
              <Link href={usersHref({ hideTest: !hideTestAccounts })} className="font-semibold text-ocean-700 hover:underline">
                {hideTestAccounts ? 'Show them' : 'Hide them'}
              </Link>
            ) : null}
          </>
        )}
        description={viewingDeletionRecords
          ? 'These are not active or manageable users. They are anonymized tombstones retained only so moderation history and integrity records remain traceable.'
          : undefined}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <AdminFilterBar label="User status filters" options={filterOptions} />
        <form method="get" action="/admin/users" className="flex gap-2 max-md:order-first lg:w-96">
          <label className="relative flex-1">
            <span className="sr-only">Search users</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              name="q"
              defaultValue={query}
              maxLength={120}
              placeholder="Name, username, headline or email"
              className="min-h-9 w-full rounded-lg border border-mist-100 bg-white py-1.5 pl-9 pr-3 text-sm text-navy-950 outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-100 max-md:min-h-11 max-md:rounded-xl max-md:bg-mist-50 max-md:text-[15px]"
            />
          </label>
          {status !== 'all' ? <input type="hidden" name="status" value={status} /> : null}
          {hideTestAccounts ? <input type="hidden" name="test" value="hide" /> : null}
          <button type="submit" className="min-h-9 rounded-lg bg-navy-950 px-3 text-sm font-semibold text-white hover:bg-navy-900 max-md:min-h-11 max-md:rounded-xl max-md:px-4">
            Search
          </button>
        </form>
      </div>

      <AdminPanel>
        {users.length === 0 ? (
          <AdminEmptyState title="No users match this view." description="Try a different search term or account-status filter." />
        ) : (
          <>
          <AdminMobileList label="User accounts">
            {users.map((user) => {
              const deleted = user.status === 'deletion_requested'
              const isTest = !deleted && looksLikeTestAccount(user)
              return (
                <AdminMobileCard
                  key={user.id}
                  title={user.fullName}
                  href={`/admin/users/${user.id}`}
                  leading={<AdminAvatar name={user.fullName} url={deleted ? null : user.avatarUrl} className="size-11" />}
                  subtitle={deleted ? 'Audit tombstone only' : [user.headline, user.slug ? `@${user.slug}` : null].filter(Boolean).join(' · ') || '—'}
                  badges={isTest ? <AdminChip tone="warning">Test account</AdminChip> : null}
                  fields={[
                    { label: 'Role', value: user.isAdministrator ? 'Admin' : 'Member' },
                    { label: 'Status', value: <AdminChip tone={statusTone[user.status]}>{statusLabels[user.status]}</AdminChip> },
                    { label: 'Joined', value: formatAdminDate(user.createdAt) },
                    { label: 'Email', value: user.email ?? (deleted ? '—' : 'None') },
                  ]}
                  actions={[
                    { kind: 'link', href: `/admin/users/${user.id}`, label: deleted ? 'View deletion record' : 'Manage user', icon: <UserCog aria-hidden="true" /> },
                    ...(!deleted && user.slug ? [{ kind: 'link' as const, href: `/people/${user.slug}`, label: 'View public profile', icon: <ExternalLink aria-hidden="true" /> }] : []),
                  ]}
                />
              )
            })}
          </AdminMobileList>
          <div className={ADMIN_TABLE_DESKTOP_CLASS}>
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
                          <AdminAvatar name={user.fullName} url={deleted ? null : user.avatarUrl} />
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
                          className="inline-flex min-h-8 items-center whitespace-nowrap rounded-lg border border-mist-200 px-3 text-xs font-semibold text-navy-950 transition hover:border-ocean-200 hover:bg-ocean-50"
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
          </>
        )}
      </AdminPanel>

      <AdminPagination
        label="User list pages"
        page={page}
        hasNext={hasNextPage}
        hrefFor={(target) => usersHref({ page: target })}
      />
    </main>
  )
}
