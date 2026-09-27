import { getAccessContext } from '@/features/access/server'
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

export type HomeOrganizationShortcuts = {
  memberships: MemberOrganizationShortcut[]
  application: HomeOrganizationApplication | null
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
      organizations,
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
