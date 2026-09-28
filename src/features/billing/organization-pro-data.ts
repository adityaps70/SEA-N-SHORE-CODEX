import type { AccessContext } from '@/features/access/policy'
import { getAccessContext } from '@/features/access/server'
import { organizationRepository } from '@/features/organizations/repository'
import type { UserOrganizationMembershipSummary } from '@/features/organizations/repository'
import type { UserOrganizationState } from '@/features/organizations/types'
import { organizationProCandidates, resolveOrganizationProPath } from './organization-pro-path'

/**
 * Server loader for the Organization Pro path. Pass values the page already loaded to
 * avoid reading them twice.
 */
export async function loadOrganizationProPath(userId: string, preloaded: {
  access?: AccessContext
  organizations?: UserOrganizationMembershipSummary[]
  application?: UserOrganizationState
} = {}) {
  const [access, organizations, application] = await Promise.all([
    preloaded.access ?? getAccessContext(userId),
    preloaded.organizations ?? organizationRepository.listUserOrganizations(userId),
    preloaded.application ?? organizationRepository.getUserOrganizationState(userId),
  ])
  return {
    path: resolveOrganizationProPath({ access, organizations, application }),
    candidates: organizationProCandidates(access, organizations),
  }
}
