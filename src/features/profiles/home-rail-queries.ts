import type { AccessContext, PlanCode } from '@/features/access/policy'
import { getAccessContext } from '@/features/access/server'
import { canUpgradeOrganization } from '@/features/billing/billing-access'
import { organizationRepository } from '@/features/organizations/repository'
import type { OrganizationApplicationStatus, UserOrganizationState } from '@/features/organizations/types'
import { organizationLinkRepository, type MemberOrganizationShortcut } from './organization-link-repository'

export type HomeOrganizationApplication = {
  companyName: string
  status: Exclude<OrganizationApplicationStatus, 'approved'>
  statusLabel: string
  href: string
  linkLabel: string
}

/** A Home shortcut with the organization's plan, for the "Free plan · Upgrade" line. */
export type HomeOrganizationShortcut = MemberOrganizationShortcut & {
  plan: PlanCode
  /** Owner or administrator of a verified organization on the free plan. */
  canUpgrade: boolean
}

export type HomeOrganizationShortcuts = {
  memberships: HomeOrganizationShortcut[]
  application: HomeOrganizationApplication | null
}

export function withOrganizationPlans(memberships: readonly MemberOrganizationShortcut[], access: AccessContext | null): HomeOrganizationShortcut[] {
  return memberships.map((organization) => ({
    ...organization,
    plan: access?.organizationMemberships.find((entry) => entry.companyId === organization.id)?.plan ?? 'free',
    canUpgrade: access ? canUpgradeOrganization(access, organization.id) : false,
  }))
}

export type HomeRailData = {
  /** True when the member holds at least one approved Sea N Shore verification. */
  verified: boolean
  /** Null when the organizations could not be loaded. */
  organizations: HomeOrganizationShortcuts | null
}

const APPLICATION_DISPLAY: Record<HomeOrganizationApplication['status'], Pick<HomeOrganizationApplication, 'statusLabel' | 'href' | 'linkLabel'>> = {
  pending: { statusLabel: 'Sea N Shore is reviewing', href: '/organizations#your-organizations', linkLabel: 'View application' },
  changes_requested: { statusLabel: 'Changes requested', href: '/organizations#update-application', linkLabel: 'Update application' },
  rejected: { statusLabel: 'Not approved', href: '/organizations#update-application', linkLabel: 'Review and resubmit' },
  suspended: { statusLabel: 'Suspended', href: '/organizations#your-organizations', linkLabel: 'See details' },
}

export function homeOrganizationApplication(
  state: UserOrganizationState,
  memberships: readonly MemberOrganizationShortcut[],
): HomeOrganizationApplication | null {
  if (state.kind !== 'application' || state.status === 'approved') return null
  if (memberships.some((organization) => organization.id === state.company.id)) return null
  return { companyName: state.company.name, status: state.status, ...APPLICATION_DISPLAY[state.status] }
}

type HomeRailDependencies = {
  getAccessContext: typeof getAccessContext
  listMemberOrganizations: (userId: string) => Promise<MemberOrganizationShortcut[]>
  getUserOrganizationState: (userId: string) => Promise<UserOrganizationState>
}

export function createHomeRailQueries(dependencies: HomeRailDependencies) {
  async function getHomeRailData(userId: string): Promise<HomeRailData> {
    const [access, organizations] = await Promise.all([
      dependencies.getAccessContext(userId).catch(() => null),
      Promise.all([
        dependencies.listMemberOrganizations(userId),
        dependencies.getUserOrganizationState(userId),
      ])
        .then(([memberships, state]) => ({
          memberships,
          application: homeOrganizationApplication(state, memberships),
        }))
        .catch(() => null),
    ])

    return {
      verified: Boolean(access?.verifications.length),
      organizations: organizations
        ? { memberships: withOrganizationPlans(organizations.memberships, access), application: organizations.application }
        : null,
    }
  }

  return { getHomeRailData }
}

const productionQueries = createHomeRailQueries({
  getAccessContext,
  listMemberOrganizations: organizationLinkRepository.listMemberOrganizations,
  getUserOrganizationState: organizationRepository.getUserOrganizationState,
})

export const getHomeRailData = productionQueries.getHomeRailData
