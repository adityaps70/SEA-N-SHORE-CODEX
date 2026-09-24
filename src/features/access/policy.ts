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

const FREE_CAPABILITIES: readonly Capability[] = [
  'job.apply',
  'event.attend',
  'course.enroll',
]

const PERSONAL_PLAN_CAPABILITIES: Record<PlanCode, readonly Capability[]> = {
  free: FREE_CAPABILITIES,
  creator_pro: [
    ...FREE_CAPABILITIES,
    'job.publish',
    'event.publish',
    'course.publish',
  ],
  organization_pro: FREE_CAPABILITIES,
}

const ORGANIZATION_PLAN_CAPABILITIES: Record<PlanCode, readonly Capability[]> = {
  free: FREE_CAPABILITIES,
  creator_pro: FREE_CAPABILITIES,
  organization_pro: [
    ...FREE_CAPABILITIES,
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
  ],
}

const PERSONAL_VERIFICATION_REQUIREMENTS: Partial<Record<Capability, VerificationType>> = {
  'job.publish': 'recruiter',
  'event.publish': 'event_host',
  'course.publish': 'trainer',
}

const ROLE_CAPABILITIES: Record<OrganizationAccessRole, readonly Capability[]> = {
  owner: ORGANIZATION_PLAN_CAPABILITIES.organization_pro,
  administrator: ORGANIZATION_PLAN_CAPABILITIES.organization_pro,
  recruiter: ['job.publish', 'job.manage_applicants'],
  lms_manager: ['course.publish', 'course.manage_students'],
  event_manager: ['event.publish', 'event.manage_attendees'],
  content_manager: [],
  analyst: ['analytics.view'],
  member: [],
}

function uniqueCapabilities(values: readonly Capability[]) {
  return [...new Set(values)]
}

function personalCapabilities(access: AccessContext) {
  const candidates = uniqueCapabilities([
    ...PERSONAL_PLAN_CAPABILITIES[access.personalPlan],
    ...access.personalEntitlements,
  ])

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

  const planCapabilities = ORGANIZATION_PLAN_CAPABILITIES[membership.plan]
  const roleCapabilities = ROLE_CAPABILITIES[membership.role]

  return uniqueCapabilities([
    ...FREE_CAPABILITIES,
    ...membership.entitlements,
    ...planCapabilities.filter((capability) => roleCapabilities.includes(capability)),
  ])
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
