import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { AdminEmptyState, AdminPageHeader, AdminPanel } from '@/features/admin/components/admin-ui'
import { adminRepository, type AdminOrganizationCountryTarget } from '@/features/admin/repository'
import { COUNTRY_SCHEMA_MISSING_MESSAGE, CountrySchemaMissingError } from '@/features/countries/country-schema'
import { countryLabel } from '@/features/countries/admin-country-view'
import { AdminOrganizationCountryForm } from '@/features/countries/components/admin-organization-country-form'
import { requireAdminAccess } from '@/features/admin/admin-access'

export const metadata: Metadata = { title: 'Organization country · Admin' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Round GP: set the country of an organization page that has none (or correct it). */
export default async function AdminOrganizationCountryPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params
  if (!UUID.test(companyId)) notFound()
  const admin = (await requireAdminAccess('platform')).user
  let organization: AdminOrganizationCountryTarget | null
  try {
    organization = await adminRepository.getOrganizationCountryTarget(admin.id, companyId)
  } catch (error) {
    // Round GP safety net: this release can run before migration 0108 is applied.
    if (error instanceof CountrySchemaMissingError) {
      return (
        <div className="space-y-4">
          <AdminPageHeader title="Organization country" />
          <AdminPanel>
            <AdminEmptyState title="Not available yet" description={COUNTRY_SCHEMA_MISSING_MESSAGE} />
          </AdminPanel>
        </div>
      )
    }
    throw error
  }
  if (!organization) notFound()

  return (
    <div className="space-y-4">
      <Link href="/admin/organizations" className="inline-flex items-center gap-1 text-sm font-semibold text-ocean-700 hover:underline">
        <ChevronLeft aria-hidden="true" className="size-4" /> Organizations
      </Link>
      <AdminPageHeader
        title={organization.name}
        meta={organization.country ? countryLabel(organization.country) : 'Country not set'}
        description="The country decides which country partner can review this organization and where it is counted in Members by country. The change is written to the audit log."
        actions={(
          <>
            <Link href={`/organizations/${organization.slug}`} className="inline-flex min-h-9 items-center rounded-lg border border-mist-200 bg-white px-3 text-sm font-semibold text-navy-950 hover:border-ocean-200 hover:bg-ocean-50">View page</Link>
            {organization.applicationId ? (
              <Link href={`/admin/organizations/${organization.applicationId}`} className="inline-flex min-h-9 items-center rounded-lg border border-mist-200 bg-white px-3 text-sm font-semibold text-navy-950 hover:border-ocean-200 hover:bg-ocean-50">Review application</Link>
            ) : null}
          </>
        )}
      />
      <AdminPanel className="p-4">
        <AdminOrganizationCountryForm companyId={organization.id} country={organization.country} />
      </AdminPanel>
    </div>
  )
}
