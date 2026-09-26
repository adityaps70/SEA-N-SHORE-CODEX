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
  if (!membership || !membership.verified) return []

  const roleCapabilities = ROLE_CAPABILITIES[membership.role]

  return uniqueCapabilities(
    membership.entitlements.filter((capability) => roleCapabilities.includes(capability)),
  )
}

export function effectiveCapabilities(access: AccessContext): Capability[] {
  if (!access.accountActive) return []
  return personalCapabilities(access)
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
