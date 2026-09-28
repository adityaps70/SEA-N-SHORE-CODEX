import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Crown } from 'lucide-react'
import { canUseCapability } from '@/features/access/policy'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { isOrganizationBillingContact } from '@/features/billing/billing-access'
import { OrganizationManageShell } from '@/features/organizations/components/organization-manage-shell'
import { OrganizationUpgradeAction } from '@/features/organizations/components/organization-upgrade-action'
import { OrganizationTeamPanel } from '@/features/organizations/components/organization-team-panel'
import { loadManageShellContext } from '@/features/organizations/manage-context'
import { organizationWorkspaceRepository } from '@/features/organizations/workspace-repository'

export const metadata: Metadata = { title: 'Organization team' }

export default async function OrganizationTeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const user = await requireAwsUser()
  const workspace = await organizationWorkspaceRepository.getBySlug(slug)
  if (!workspace) notFound()

  const access = await getAccessContext(user.id)
  const membership = access.organizationMemberships.find((entry) => entry.companyId === workspace.id)
  if (!membership) notFound()

  const canManageTeam = canUseCapability(access, 'organization.team', { companyId: workspace.id })
  const shell = await loadManageShellContext(user.id, workspace.id, access)

  return (
    <OrganizationManageShell workspace={workspace} active="team" {...shell}>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-ocean-700">Organization Pro</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy-950">Team & permissions</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
          Assign approved members the role that matches their responsibility. Roles determine which Organization Pro capabilities they can use inside this workspace.
        </p>
      </div>

      {canManageTeam ? (
        <OrganizationTeamPanel companyId={workspace.id} members={await organizationWorkspaceRepository.listMembers(workspace.id)} />
      ) : (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
          <div className="flex gap-3">
            <Crown className="mt-0.5 size-5 shrink-0 text-amber-900" aria-hidden="true" />
            <div>
              <h2 className="font-bold text-amber-950">Team management is not enabled for this workspace</h2>
              <p className="mt-2 text-sm leading-6 text-amber-900">
                Team permissions require Organization Pro and an Owner or Administrator role. Verification alone does not unlock this capability.
              </p>
              <OrganizationUpgradeAction slug={workspace.slug} canBuy={isOrganizationBillingContact(access, workspace.id)} plan={membership.plan} verified={membership.verified} />
            </div>
          </div>
        </section>
      )}
    </OrganizationManageShell>
  )
}
