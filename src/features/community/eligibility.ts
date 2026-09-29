import type { AccessContext, OrganizationAccessRole } from '@/features/access/policy'

/**
 * Who may create a community (round 9C). Pure, so the create page, the server action and
 * the tests share one rule set:
 *
 * - a member on Creator Pro may own one live community themselves. `personalPlan` comes
 *   from `account_subscriptions` rows with status trialing/active/past_due, so a running
 *   free trial already reads as 'creator_pro' here: trial members can create.
 * - an owner or administrator of a verified organization on Organization Pro may create one
 *   live community owned by that organization.
 * - Sea N Shore platform administrators are always allowed, for themselves and for any
 *   organization they belong to, with no limit.
 */

export const COMMUNITY_LIMIT_PER_OWNER = 1

/** The "Create as" form value for the member themselves; organizations send their company id. */
export const CREATE_AS_SELF = 'me'

export type MemberEligibilityReason = 'creator_pro_required' | 'limit_reached' | null
export type OrganizationEligibilityReason = 'organization_pro_required' | 'limit_reached' | 'not_admin' | null
export type CommunityEligibilityReason = Exclude<MemberEligibilityReason | OrganizationEligibilityReason, null>

export type OrganizationCreationOption = {
  companyId: string
  allowed: boolean
  reason: OrganizationEligibilityReason
}

export type CommunityCreationEligibility = {
  /** True when at least one identity (the member or one of their organizations) may create. */
  canCreate: boolean
  /** Every reason that blocks an identity, without duplicates; empty when `canCreate`. */
  reasons: CommunityEligibilityReason[]
  asMember: { allowed: boolean; reason: MemberEligibilityReason }
  asOrganizations: OrganizationCreationOption[]
}

/** One sentence per blocking reason, shared by the create page and the server action. */
export const ELIGIBILITY_REASON_TEXT: Record<CommunityEligibilityReason, string> = {
  creator_pro_required: 'Creating a community for yourself is part of Creator Pro.',
  limit_reached: `Each member and each organization can run ${COMMUNITY_LIMIT_PER_OWNER === 1 ? 'one community' : `${COMMUNITY_LIMIT_PER_OWNER} communities`} at a time.`,
  organization_pro_required: 'Creating a community for an organization is part of Organization Pro (for verified organizations).',
  not_admin: 'Only an owner or administrator of an organization can create its community.',
}

const ORGANIZATION_CREATOR_ROLES: readonly OrganizationAccessRole[] = ['owner', 'administrator']

export function isOrganizationCreatorRole(role: OrganizationAccessRole) {
  return ORGANIZATION_CREATOR_ROLES.includes(role)
}

export function communityCreationEligibility(input: {
  access: Pick<AccessContext, 'personalPlan' | 'organizationMemberships'>
  isPlatformAdmin: boolean
  /** Live communities the member owns personally. */
  ownedByMember: number
  /** Live communities per organization id. Missing entries count as zero. */
  ownedByOrganization: ReadonlyMap<string, number>
}): CommunityCreationEligibility {
  const { access, isPlatformAdmin, ownedByMember, ownedByOrganization } = input

  const asMember: CommunityCreationEligibility['asMember'] = isPlatformAdmin
    ? { allowed: true, reason: null }
    : access.personalPlan !== 'creator_pro'
      ? { allowed: false, reason: 'creator_pro_required' }
      : ownedByMember >= COMMUNITY_LIMIT_PER_OWNER
        ? { allowed: false, reason: 'limit_reached' }
        : { allowed: true, reason: null }

  const asOrganizations: OrganizationCreationOption[] = access.organizationMemberships.map((membership) => {
    if (isPlatformAdmin) return { companyId: membership.companyId, allowed: true, reason: null }
    if (!isOrganizationCreatorRole(membership.role)) return { companyId: membership.companyId, allowed: false, reason: 'not_admin' }
    // Organization Pro is only sold to verified, claimed organizations, so those read as "Pro required" too.
    if (membership.plan !== 'organization_pro' || !membership.verified || membership.unclaimed) {
      return { companyId: membership.companyId, allowed: false, reason: 'organization_pro_required' }
    }
    if ((ownedByOrganization.get(membership.companyId) ?? 0) >= COMMUNITY_LIMIT_PER_OWNER) {
      return { companyId: membership.companyId, allowed: false, reason: 'limit_reached' }
    }
    return { companyId: membership.companyId, allowed: true, reason: null }
  })

  const canCreate = asMember.allowed || asOrganizations.some((option) => option.allowed)
  const reasons: CommunityEligibilityReason[] = canCreate
    ? []
    : [...new Set([asMember.reason, ...asOrganizations.map((option) => option.reason)].filter((reason): reason is CommunityEligibilityReason => reason !== null))]

  return { canCreate, reasons, asMember, asOrganizations }
}
