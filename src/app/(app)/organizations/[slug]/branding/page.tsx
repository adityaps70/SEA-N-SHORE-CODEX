import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Crown } from 'lucide-react'
import { canUseCapability } from '@/features/access/policy'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { isOrganizationBillingContact } from '@/features/billing/billing-access'
import { OrganizationBrandingForm } from '@/features/organizations/components/organization-branding-form'
import { OrganizationManageShell } from '@/features/organizations/components/organization-manage-shell'
import { OrganizationUpgradeAction } from '@/features/organizations/components/organization-upgrade-action'
import { loadManageShellContext } from '@/features/organizations/manage-context'
import { organizationWorkspaceRepository } from '@/features/organizations/workspace-repository'

export const metadata: Metadata = { title: 'Organization page details' }

export default async function OrganizationBrandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const user = await requireAwsUser()
  const workspace = await organizationWorkspaceRepository.getBySlug(slug)
  if (!workspace) notFound()

  const access = await getAccessContext(user.id)
  const membership = access.organizationMemberships.find((entry) => entry.companyId === workspace.id)
  if (!membership) notFound()

  const canBrand = canUseCapability(access, 'organization.branding', { companyId: workspace.id })
  const shell = await loadManageShellContext(user.id, workspace.id, access)

  return (
    <OrganizationManageShell workspace={workspace} active="branding" {...shell}>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-ocean-700">Organization Pro</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy-950">Page details & branding</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
          What members see on the {workspace.name} page and on its jobs, events and courses: logo, cover image, tagline, description, size and locations.
        </p>
      </div>

      {canBrand ? (
        <OrganizationBrandingForm workspace={workspace} />
      ) : (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
          <div className="flex gap-3">
            <Crown className="mt-0.5 size-5 shrink-0 text-amber-900" aria-hidden="true" />
            <div>
              <h2 className="font-bold text-amber-950">Branding management is not enabled for this workspace</h2>
              <p className="mt-2 text-sm leading-6 text-amber-900">
                Organization branding requires Organization Pro and a workspace role permitted to manage organization content.
              </p>
              <OrganizationUpgradeAction slug={workspace.slug} canBuy={isOrganizationBillingContact(access, workspace.id)} plan={membership.plan} verified={membership.verified} />
            </div>
          </div>
        </section>
      )}
    </OrganizationManageShell>
  )
}
