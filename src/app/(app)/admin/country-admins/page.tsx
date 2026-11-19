import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAdminAccess } from '@/features/admin/admin-access'
import { AdminEmptyState, AdminPageHeader, AdminPanel, formatAdminDate } from '@/features/admin/components/admin-ui'
import { countryName } from '@/features/countries/catalog'
import { CountryAdminError, countryAdminRepository, type CountryAdminEntry } from '@/features/country-admins/repository'
import { EditCountryAdminForm, GrantCountryAdminForm } from '@/features/country-admins/components/country-admin-forms'
import { pluralize } from '@/lib/format'

export const metadata: Metadata = { title: 'Country admins · Admin' }

/**
 * Round GP (Global Partners), Part C: limited admins for country partners. Platform administrators only. A country
 * admin reviews organizations from their countries and sees their countries' numbers; nothing else.
 */
export default async function AdminCountryAdminsPage() {
  const { user } = await requireAdminAccess('platform')
  let entries: CountryAdminEntry[] | null
  try {
    entries = await countryAdminRepository.list(user.id)
  } catch (error) {
    if (error instanceof CountryAdminError && error.message === 'country_admins_unavailable') entries = null
    else throw error
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Country admins"
        meta={entries ? pluralize(entries.length, 'country admin') : undefined}
        description="Country admins review and approve organizations from their own countries, and see those countries’ numbers in Members by country. They cannot see member lists, emails or phone numbers, payments, plans, ranks, site settings or any other admin page, and every decision they make is in the audit log. They must use an authenticator app to sign in, like administrators."
      />

      {entries === null ? (
        <AdminPanel>
          <AdminEmptyState title="Not available yet" description="The database update for country admins (migrations 0109 and 0110) has not been applied." />
        </AdminPanel>
      ) : (
        <>
          <AdminPanel className="p-4">
            <h3 className="mb-3 text-base font-semibold text-navy-950">Add a country admin</h3>
            <GrantCountryAdminForm />
          </AdminPanel>

          <AdminPanel>
            {entries.length === 0 ? (
              <AdminEmptyState title="No country admins yet." description="Add one above: an existing member and the countries they will review." />
            ) : (
              <ul className="divide-y divide-mist-100">
                {entries.map((entry) => (
                  <li key={entry.profileId} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
                    <div className="min-w-0">
                      <p className="font-semibold text-navy-950">
                        <Link href={`/admin/users/${entry.profileId}`} className="hover:text-ocean-700 hover:underline">{entry.fullName}</Link>
                        {entry.slug ? <span className="ml-2 text-sm font-normal text-muted">@{entry.slug}</span> : null}
                      </p>
                      <p className="mt-1 text-sm text-navy-900">{entry.countries.map((code) => countryName(code) ?? code).join(', ')}</p>
                      <p className="mt-1 text-xs text-muted">
                        Country admin since {formatAdminDate(entry.grantedAt)} · Last active {entry.lastActiveAt ? formatAdminDate(entry.lastActiveAt, true) : 'never'}
                      </p>
                      <p className="mt-1 text-xs">
                        <Link href={`/admin/audit?actor=${entry.profileId}`} className="font-semibold text-ocean-700 hover:underline">Their actions in the audit log</Link>
                      </p>
                    </div>
                    <EditCountryAdminForm profileId={entry.profileId} name={entry.fullName} countries={entry.countries} />
                  </li>
                ))}
              </ul>
            )}
          </AdminPanel>
        </>
      )}
    </div>
  )
}
