export const PLAN_CODES = ['free', 'creator_pro', 'organization_pro'] as const
export type PlanCode = (typeof PLAN_CODES)[number]

export const VERIFICATION_TYPES = ['recruiter', 'trainer', 'event_host'] as const
export type VerificationType = (typeof VERIFICATION_TYPES)[number]

export const CAPABILITIES = [
  'job.apply',
  'event.attend',
  'course.enroll',
  'job.publish',
  'event.publish',
  'course.publish',
  'job.manage_applicants',
  'event.manage_attendees',
  'course.manage_students',
  'organization.manage',
  'organization.team',
  'organization.branding',
  'analytics.view',
  'billing.manage',
] as const
export type Capability = (typeof CAPABILITIES)[number]

export type OrganizationAccessRole =
  | 'owner'
  | 'administrator'
  | 'recruiter'
  | 'lms_manager'
  | 'event_manager'
  | 'content_manager'
  | 'analyst'
  | 'member'

export type OrganizationAccessMembership = {
  companyId: string
  plan: PlanCode
  role: OrganizationAccessRole
  verified: boolean
  /**
   * True for an unclaimed organization page (added by someone who works there).
   * Nobody may publish or post for it until it is claimed and verified.
   */
  unclaimed?: boolean
  entitlements: Capability[]
}

export type AccessContext = {
  personalPlan: PlanCode
  personalEntitlements: Capability[]
  verifications: VerificationType[]
  organizationMemberships: OrganizationAccessMembership[]
  accountActive: boolean
}

const PERSONAL_VERIFICATION_REQUIREMENTS: Partial<Record<Capability, VerificationType>> = {
  'job.publish': 'recruiter',
  'job.manage_applicants': 'recruiter',
  'event.publish': 'event_host',
  'event.manage_attendees': 'event_host',
  'course.publish': 'trainer',
  'course.manage_students': 'trainer',
}

const ROLE_CAPABILITIES: Record<OrganizationAccessRole, readonly Capability[]> = {
  owner: CAPABILITIES,
  administrator: CAPABILITIES,
  recruiter: ['job.publish', 'job.manage_applicants'],
  lms_manager: ['course.publish', 'course.manage_students'],
  event_manager: ['event.publish', 'event.manage_attendees'],
  content_manager: ['organization.branding'],
  analyst: ['analytics.view'],
  member: [],
}

function uniqueCapabilities(values: readonly Capability[]) {
  return [...new Set(values)]
}

function personalCapabilities(access: AccessContext) {
  const candidates = uniqueCapabilities(access.personalEntitlements)

  return candidates.filter((capability) => {
    const verification = PERSONAL_VERIFICATION_REQUIREMENTS[capability]
    return !verification || access.verifications.includes(verification)
  })
}

function organizationCapabilities(
  access: AccessContext,
  companyId: string,
): Capability[] {
  const membership = access.organizationMemberships.find((entry) => entry.companyId === companyId)
  if (!membership || !membership.verified || membership.unclaimed) return []

  const roleCapabilities = ROLE_CAPABILITIES[membership.role]

  return uniqueCapabilities(
    membership.entitlements.filter((capability) => roleCapabilities.includes(capability)),
  )
}

export function effectiveCapabilities(access: AccessContext): Capability[] {
  if (!access.accountActive) return []
  return personalCapabilities(access)
}

/**
 * Organization capabilities that come from a member's role alone, with no paid plan.
 * They are kept apart from CAPABILITIES because they are not plan entitlements and
 * cannot be granted from the admin entitlement screens.
 * - organization.post: publish, edit and delete feed posts as the organization.
 * - organization.manage_posts: edit or delete any post published as the organization.
 */
export const ORGANIZATION_ROLE_CAPABILITIES = ['organization.post', 'organization.manage_posts'] as const
export type OrganizationRoleCapability = (typeof ORGANIZATION_ROLE_CAPABILITIES)[number]

const ORGANIZATION_ROLE_GRANTS: Record<OrganizationRoleCapability, {
  roles: readonly OrganizationAccessRole[]
  requiresVerifiedOrganization: boolean
}> = {
  'organization.post': { roles: ['owner', 'administrator', 'content_manager'], requiresVerifiedOrganization: true },
  // Admins can always clean up their organization's posts, even while it is re-verified.
  'organization.manage_posts': { roles: ['owner', 'administrator'], requiresVerifiedOrganization: false },
}

export function canUseOrganizationRoleCapability(
  access: AccessContext,
  capability: OrganizationRoleCapability,
  companyId: string,
): boolean {
  if (!access.accountActive || !companyId) return false
  const membership = access.organizationMemberships.find((entry) => entry.companyId === companyId)
  if (!membership || membership.unclaimed) return false
  const grant = ORGANIZATION_ROLE_GRANTS[capability]
  if (grant.requiresVerifiedOrganization && !membership.verified) return false
  return grant.roles.includes(membership.role)
}

/** Approved member of a verified organization with an owner, administrator or content role. */
export function canPostAsOrganization(access: AccessContext, companyId: string) {
  return canUseOrganizationRoleCapability(access, 'organization.post', companyId)
}

/** Organization ids the member may publish feed posts for, in membership order. */
export function organizationsMemberCanPostFor(access: AccessContext): string[] {
  return access.organizationMemberships
    .filter((membership) => canPostAsOrganization(access, membership.companyId))
    .map((membership) => membership.companyId)
}

export function canUseCapability(
  access: AccessContext,
  capability: Capability,
  options: { companyId?: string } = {},
): boolean {
  if (!access.accountActive) return false

  if (options.companyId) {
    return organizationCapabilities(access, options.companyId).includes(capability)
  }

  return personalCapabilities(access).includes(capability)
}
