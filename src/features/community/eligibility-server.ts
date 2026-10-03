import type { OrganizationAccessRole, PlanCode } from '@/features/access/policy'
import { getAccessContext } from '@/features/access/server'
import { canAccessPlatformAdmin } from '@/features/admin/access'
import { organizationRepository } from '@/features/organizations/repository'
import { communityCreationEligibility, isOrganizationCreatorRole, type CommunityCreationEligibility, type OrganizationEligibilityReason } from './eligibility'
import { communityRepository } from './repository'

/** An organization the member belongs to, with whether they may create a community for it. */
export type CommunityCreationOrganization = {
  id: string
  slug: string
  name: string
  role: OrganizationAccessRole
  allowed: boolean
  reason: OrganizationEligibilityReason
}

export type CommunityCreationOptions = {
  eligibility: CommunityCreationEligibility
  isPlatformAdmin: boolean
  personalPlan: PlanCode
  /** Every organization membership, in the access-context order, with the option's verdict. */
  organizations: CommunityCreationOrganization[]
}

/**
 * Loads everything `communityCreationEligibility` needs for one member: their plans, whether
 * they are a Sea N Shore administrator and how many live communities they (and each
 * organization they could create for) already own. The create page and the server action
 * both call this, so the client is never trusted.
 */
export async function getCommunityCreationEligibility(userId: string): Promise<CommunityCreationOptions> {
  const [access, isPlatformAdmin, ownedByMember, organizations] = await Promise.all([
    getAccessContext(userId),
    canAccessPlatformAdmin(userId),
    communityRepository.countLiveGroupsOwnedByMember(userId),
    organizationRepository.listUserOrganizations(userId).catch((): Array<{ id: string; slug: string; name: string }> => []),
  ])

  // Only organizations the member could create for need a count.
  const countable = access.organizationMemberships.filter((membership) => isPlatformAdmin || isOrganizationCreatorRole(membership.role))
  const counts = await Promise.all(countable.map(async (membership) => [membership.companyId, await communityRepository.countLiveGroupsOwnedByOrganization(membership.companyId)] as const))
  const eligibility = communityCreationEligibility({ access, isPlatformAdmin, ownedByMember, ownedByOrganization: new Map(counts) })

  const summaries = new Map(organizations.map((organization) => [organization.id, organization] as const))
  const options = eligibility.asOrganizations.flatMap((option) => {
    const membership = access.organizationMemberships.find((entry) => entry.companyId === option.companyId)
    const summary = summaries.get(option.companyId)
    if (!membership || !summary) return []
    return [{ id: option.companyId, slug: summary.slug, name: summary.name, role: membership.role, allowed: option.allowed, reason: option.reason }]
  })

  return { eligibility, isPlatformAdmin, personalPlan: access.personalPlan, organizations: options }
}
