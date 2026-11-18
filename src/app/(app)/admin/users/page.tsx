import type { Metadata } from 'next'
import Link from '@/components/navigation/intent-link'
import { ExternalLink, Search, ShieldCheck, UserCog } from 'lucide-react'
import { withAdminAvatarUrls } from '@/features/admin/avatars'
import { signInMethodsLabel } from '@/features/admin/sign-in-methods'
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
import { adminCountryRepository, type MemberCountry } from '@/features/countries/admin-country-repository'
import { countryLabel, countrySlug, readCountrySlug } from '@/features/countries/admin-country-view'
import { isEstimatedCountrySource } from '@/features/countries/member-country-sql'
import { requireAdminAccess } from '@/features/admin/admin-access'

export const metadata: Metadata = { title: 'Users · Admin' }

/** Default page size, shared with the organizations directory; ?size= picks 25, 50 or 100 (round 10). */
const PAGE_SIZE = 50
const PAGE_SIZES = [25, 50, 100] as const

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

function readPageSize(value: string | string[] | undefined) {
  const size = Number.parseInt(readSingle(value), 10)
  return (PAGE_SIZES as readonly number[]).includes(size) ? size : PAGE_SIZE
}

/** Round GP: a member's country in the list, "estimated" when it is not one they chose. */
function MemberCountryValue({ country }: { country: MemberCountry | undefined }) {
  if (!country?.code) return <span className="text-muted">Not set</span>
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="truncate">{countryLabel(country.code)}</span>
      {isEstimatedCountrySource(country.source) ? <AdminChip tone="info">estimated</AdminChip> : null}
    </span>
  )
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
  const admin = (await requireAdminAccess('platform')).user
  const hideTestAccounts = readSingle(params.test) === 'hide'
  const page = readAdminPage(params.page)
  const pageSize = readPageSize(params.size)
  // Round GP: ?country=PH (or "unset") from Admin › Members by country.
  const countryCode = readCountrySlug(readSingle(params.country))
  const country = countryCode === undefined ? undefined : countrySlug(countryCode)
  // One extra row tells us whether there is a next page; the count uses the same filter.
  const [fetched, totalUsers] = await Promise.all([
    adminRepository.searchUsers(admin.id, {
      query,
      status,
      limit: pageSize + 1,
      offset: (page - 1) * pageSize,
      country,
    }),
    adminRepository.countUsers(admin.id, { query, status, country }),
  ])
  const hasNextPage = fetched.length > pageSize
  const results = fetched.slice(0, pageSize)
  const totalPages = Math.max(1, Math.ceil(totalUsers / pageSize))

  const viewingDeletionRecords = status === 'deletion_requested'
  const testAccounts = viewingDeletionRecords ? 0 : results.filter(looksLikeTestAccount).length
  const users = await withAdminAvatarUrls(
    hideTestAccounts && !viewingDeletionRecords ? results.filter((user) => !looksLikeTestAccount(user)) : results,
  )
  // A failed country read leaves the column at "Not set" rather than failing the list.
  const countries = viewingDeletionRecords
    ? new Map<string, MemberCountry>()
    : await adminCountryRepository.memberCountries(admin.id, users.map((user) => user.id)).catch(() => new Map<string, MemberCountry>())

  function usersHref(next: { status?: AdminUserStatusFilter; hideTest?: boolean; page?: number; size?: number }) {
    const search = new URLSearchParams()
    if (query) search.set('q', query)
    const nextStatus = next.status ?? status
    if (nextStatus !== 'all') search.set('status', nextStatus)
    if (next.hideTest ?? hideTestAccounts) search.set('test', 'hide')
    if (country) search.set('country', country)
    const nextSize = next.size ?? pageSize
    if (nextSize !== PAGE_SIZE) search.set('size', String(nextSize))
    // Changing a filter starts again from the first page.
    if (next.page && next.page > 1) search.set('page', String(next.page))
    const value = search.toString()
    return `/admin/users${value ? `?${value}` : ''}`
  }

  const countNoun = viewingDeletionRecords ? 'record' : 'user'
  const resultsLabel = `${totalUsers.toLocaleString('en-IN')} ${totalUsers === 1 ? countNoun : `${countNoun}s`}${query ? ' found' : ''} · Page ${Math.min(page, totalPages).toLocaleString('en-IN')} of ${totalPages.toLocaleString('en-IN')}`

  const filterOptions = (['all', ...ADMIN_USER_STATUSES] as AdminUserStatusFilter[]).map((item) => ({
    href: usersHref({ status: item }),
    label: filterLabels[item],
    active: item === status,
  }))

  return (
    <div className="space-y-4">
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
        actions={country ? (
          <>
            <AdminChip tone="info">Country: {countryLabel(countryCode ?? null)}</AdminChip>
            <Link href={`/admin/users${query || status !== 'all' ? `?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(status !== 'all' ? { status } : {}) }).toString()}` : ''}`} className="text-sm font-semibold text-ocean-700 hover:underline">All countries</Link>
          </>
        ) : undefined}
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
          {pageSize !== PAGE_SIZE ? <input type="hidden" name="size" value={pageSize} /> : null}
          {country ? <input type="hidden" name="country" value={country} /> : null}
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
                    ...(deleted ? [] : [{ label: 'Country', value: <MemberCountryValue country={countries.get(user.id)} /> }]),
                    {
                      label: 'Email',
                      value: signInMethodsLabel(user)
                        ? <>{user.email ?? (deleted ? '—' : 'None')}<span className="block text-xs text-muted">{signInMethodsLabel(user)}</span></>
                        : user.email ?? (deleted ? '—' : 'None'),
                    },
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
                <col className="w-[31%]" />
                <col className="w-[21%]" />
                <col className="w-[14%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[14%]" />
              </colgroup>
              <thead className="border-b border-mist-100 bg-mist-50/70 text-xs font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5">Member</th>
                  <th scope="col" className="px-4 py-2.5">Email</th>
                  <th scope="col" className="px-4 py-2.5">Country</th>
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
                      <td className="truncate px-4 py-2.5 text-navy-900" title={user.email ?? undefined}>
                        {user.email ?? (deleted ? '—' : 'No email retained')}
                        {signInMethodsLabel(user) ? <span className="block truncate text-xs text-muted">{signInMethodsLabel(user)}</span> : null}
                      </td>
                      <td className="px-4 py-2.5 text-navy-900">{deleted ? <span className="text-muted">—</span> : <MemberCountryValue country={countries.get(user.id)} />}</td>
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

      <div className="flex flex-col gap-3">
        <AdminPagination
          label="User list pages"
          page={page}
          hasNext={hasNextPage}
          totalPages={totalPages}
          hrefFor={(target) => usersHref({ page: target })}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <nav aria-label="Users per page" className="flex items-center gap-1">
            <span className="mr-1">Show</span>
            {PAGE_SIZES.map((size) => (
              size === pageSize
                ? <span key={size} aria-current="true" className="inline-flex min-h-8 items-center rounded-lg bg-navy-950 px-2.5 text-xs font-semibold text-white tabular-nums">{size}</span>
                : <Link key={size} href={usersHref({ size, page: 1 })} className="inline-flex min-h-8 items-center rounded-lg border border-mist-200 bg-white px-2.5 text-xs font-semibold text-navy-950 tabular-nums hover:border-ocean-200 hover:bg-ocean-50">{size}</Link>
            ))}
            <span className="ml-1">per page</span>
          </nav>
          {totalPages > 1 ? (
            <form method="get" action="/admin/users" className="flex items-center gap-2">
              {query ? <input type="hidden" name="q" value={query} /> : null}
              {status !== 'all' ? <input type="hidden" name="status" value={status} /> : null}
              {hideTestAccounts ? <input type="hidden" name="test" value="hide" /> : null}
              {pageSize !== PAGE_SIZE ? <input type="hidden" name="size" value={pageSize} /> : null}
              {country ? <input type="hidden" name="country" value={country} /> : null}
              <label htmlFor="admin-users-jump">Go to page</label>
              <input
                id="admin-users-jump"
                type="number"
                name="page"
                min={1}
                max={totalPages}
                defaultValue={Math.min(page, totalPages)}
                className="min-h-8 w-20 rounded-lg border border-mist-200 bg-white px-2 text-sm text-navy-950 tabular-nums outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-100"
              />
              <button type="submit" className="min-h-8 rounded-lg border border-mist-200 bg-white px-3 text-xs font-semibold text-navy-950 hover:border-ocean-200 hover:bg-ocean-50">Go</button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  )
}
