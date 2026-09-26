import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Crown, UsersRound } from 'lucide-react'
import { canUseCapability } from '@/features/access/policy'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { OrganizationTeamPanel } from '@/features/organizations/components/organization-team-panel'
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

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <Link href={'/organizations/' + workspace.slug} className="text-sm font-bold text-muted hover:text-navy-950">← {workspace.name}</Link>
        <div className="mt-3 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-ocean-50 text-ocean-700"><UsersRound aria-hidden="true" className="size-5" /></span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-ocean-700">Organization Pro</p>
            <h1 className="text-3xl font-bold text-navy-950">Team & permissions</h1>
          </div>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
          Assign approved members the role that matches their responsibility. Roles determine which Organization Pro capabilities they can use inside this workspace.
        </p>
      </div>

      {canManageTeam ? (
        <OrganizationTeamPanel companyId={workspace.id} members={await organizationWorkspaceRepository.listMembers(workspace.id)} />
      ) : (
        <section className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-6">
          <div className="flex gap-3">
            <Crown className="mt-0.5 size-5 shrink-0 text-amber-900" aria-hidden="true" />
            <div>
              <h2 className="font-bold text-amber-950">Team management is not enabled for this workspace</h2>
              <p className="mt-2 text-sm leading-6 text-amber-900">
                Team permissions require Organization Pro and an Owner or Administrator role. Verification alone does not unlock this capability.
              </p>
              <Link href="/plans" className="mt-4 inline-flex rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white">View Organization Pro</Link>
            </div>
          </div>
        </section>
      )}
    </main>
  )
}
