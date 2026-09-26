import { describe, expect, it } from 'vitest'
import {
  CAPABILITIES,
  PLAN_CODES,
  VERIFICATION_TYPES,
  canUseCapability,
  effectiveCapabilities,
  type AccessContext,
  type Capability,
  type OrganizationAccessRole,
  type PlanCode,
  type VerificationType,
} from './policy'

const TEST_PLAN_ENTITLEMENTS: Record<PlanCode, Capability[]> = {
  free: ['job.apply', 'event.attend', 'course.enroll'],
  creator_pro: [
    'job.apply', 'event.attend', 'course.enroll',
    'job.publish', 'event.publish', 'course.publish',
    'job.manage_applicants', 'event.manage_attendees', 'course.manage_students',
  ],
  organization_pro: [
    'job.apply', 'event.attend', 'course.enroll',
    'job.publish', 'event.publish', 'course.publish',
    'job.manage_applicants', 'event.manage_attendees', 'course.manage_students',
    'organization.manage', 'organization.team', 'organization.branding', 'analytics.view', 'billing.manage',
  ],
}

function personalPlanEntitlements(plan: PlanCode): Capability[] {
  return plan === 'creator_pro' ? TEST_PLAN_ENTITLEMENTS.creator_pro : TEST_PLAN_ENTITLEMENTS.free
}

function organizationPlanEntitlements(plan: PlanCode): Capability[] {
  return plan === 'organization_pro' ? TEST_PLAN_ENTITLEMENTS.organization_pro : TEST_PLAN_ENTITLEMENTS.free
}

function context(overrides: Partial<AccessContext> = {}): AccessContext {
  const personalPlan = overrides.personalPlan ?? 'free'
  const organizationMemberships = (overrides.organizationMemberships ?? []).map((membership) => ({
    ...membership,
    entitlements: membership.entitlements.length
      ? membership.entitlements
      : organizationPlanEntitlements(membership.plan),
  }))

  return {
    personalPlan,
    personalEntitlements: overrides.personalEntitlements ?? personalPlanEntitlements(personalPlan),
    verifications: overrides.verifications ?? [],
    organizationMemberships,
    accountActive: overrides.accountActive ?? true,
  }
}

describe('central paid capability policy', () => {
  it('keeps normal member participation free', () => {
    const access = context()

    expect(canUseCapability(access, 'job.apply')).toBe(true)
    expect(canUseCapability(access, 'event.attend')).toBe(true)
    expect(canUseCapability(access, 'course.enroll')).toBe(true)
  })

  it('does not let payment bypass recruiter verification', () => {
    const access = context({ personalPlan: 'creator_pro' })

    expect(canUseCapability(access, 'job.publish')).toBe(false)
  })

  it('allows a verified Creator Pro recruiter to publish jobs personally', () => {
    const access = context({
      personalPlan: 'creator_pro',
      verifications: ['recruiter'],
    })

    expect(canUseCapability(access, 'job.publish')).toBe(true)
  })

  it('lets each verified Creator Pro identity manage the audience created by its own content', () => {
    expect(canUseCapability(context({
      personalPlan: 'creator_pro',
      verifications: ['recruiter'],
    }), 'job.manage_applicants')).toBe(true)

    expect(canUseCapability(context({
      personalPlan: 'creator_pro',
      verifications: ['event_host'],
    }), 'event.manage_attendees')).toBe(true)

    expect(canUseCapability(context({
      personalPlan: 'creator_pro',
      verifications: ['trainer'],
    }), 'course.manage_students')).toBe(true)
  })

  it('does not let recruiter verification unlock unrelated paid creator features', () => {
    const access = context({
      personalPlan: 'creator_pro',
      verifications: ['recruiter'],
    })

    expect(canUseCapability(access, 'event.publish')).toBe(false)
    expect(canUseCapability(access, 'course.publish')).toBe(false)
  })

  it('allows trainer and event-host capabilities only with their own verification', () => {
    expect(canUseCapability(context({
      personalPlan: 'creator_pro',
      verifications: ['trainer'],
    }), 'course.publish')).toBe(true)

    expect(canUseCapability(context({
      personalPlan: 'creator_pro',
      verifications: ['event_host'],
    }), 'event.publish')).toBe(true)
  })

  it('supports narrowly scoped grandfathered capabilities without granting an entire paid plan', () => {
    const access = context({
      personalEntitlements: ['job.publish'],
      verifications: ['recruiter'],
    })

    expect(canUseCapability(access, 'job.publish')).toBe(true)
    expect(canUseCapability(access, 'event.publish')).toBe(false)
    expect(canUseCapability(access, 'course.publish')).toBe(false)
  })

  it('supports verified Organization Pro capabilities through an approved organization role', () => {
    const access = context({
      organizationMemberships: [{
        companyId: 'company-1',
        plan: 'organization_pro',
        role: 'recruiter',
        verified: true,
        entitlements: [],
      }],
    })

    expect(canUseCapability(access, 'job.publish', { companyId: 'company-1' })).toBe(true)
  })

  it('does not let an organization plan bypass company verification or role scope', () => {
    expect(canUseCapability(context({
      organizationMemberships: [{
        companyId: 'company-1',
        plan: 'organization_pro',
        role: 'recruiter',
        verified: false,
        entitlements: [],
      }],
    }), 'job.publish', { companyId: 'company-1' })).toBe(false)

    expect(canUseCapability(context({
      organizationMemberships: [{
        companyId: 'company-1',
        plan: 'organization_pro',
        role: 'member',
        verified: true,
        entitlements: [],
      }],
    }), 'job.publish', { companyId: 'company-1' })).toBe(false)
  })

  it('denies every personal, manual and organization capability when the account is suspended', () => {
    const access = context({
      accountActive: false,
      personalPlan: 'creator_pro',
      personalEntitlements: ['job.publish', 'event.publish', 'course.publish'],
      verifications: ['recruiter', 'trainer', 'event_host'],
      organizationMemberships: [{
        companyId: 'company-1',
        plan: 'organization_pro',
        role: 'owner',
        verified: true,
        entitlements: ['analytics.view', 'job.publish'],
      }],
    })

    expect(effectiveCapabilities(access)).toEqual([])
    expect(canUseCapability(access, 'job.publish')).toBe(false)
    expect(canUseCapability(access, 'event.publish')).toBe(false)
    expect(canUseCapability(access, 'course.publish')).toBe(false)
    expect(canUseCapability(access, 'job.publish', { companyId: 'company-1' })).toBe(false)
    expect(canUseCapability(access, 'analytics.view', { companyId: 'company-1' })).toBe(false)
  })
})


const FREE_CAPABILITIES = new Set<Capability>([
  'job.apply',
  'event.attend',
  'course.enroll',
])

const PERSONAL_PUBLISH_REQUIREMENTS: Partial<Record<Capability, VerificationType>> = {
  'job.publish': 'recruiter',
  'job.manage_applicants': 'recruiter',
  'event.publish': 'event_host',
  'event.manage_attendees': 'event_host',
  'course.publish': 'trainer',
  'course.manage_students': 'trainer',
}

const ORGANIZATION_ROLES: OrganizationAccessRole[] = [
  'owner',
  'administrator',
  'recruiter',
  'lms_manager',
  'event_manager',
  'content_manager',
  'analyst',
  'member',
]

const ORGANIZATION_ROLE_CAPABILITIES: Record<OrganizationAccessRole, readonly Capability[]> = {
  owner: CAPABILITIES,
  administrator: CAPABILITIES,
  recruiter: ['job.publish', 'job.manage_applicants'],
  lms_manager: ['course.publish', 'course.manage_students'],
  event_manager: ['event.publish', 'event.manage_attendees'],
  content_manager: ['organization.branding'],
  analyst: ['analytics.view'],
  member: [],
}

const VERIFICATION_COMBINATIONS = VERIFICATION_TYPES.reduce<VerificationType[][]>(
  (sets, verification) => [
    ...sets,
    ...sets.map((set) => [...set, verification]),
  ],
  [[]],
)

function expectedPersonalCapability(
  plan: PlanCode,
  verifications: readonly VerificationType[],
  capability: Capability,
) {
  if (FREE_CAPABILITIES.has(capability)) return true
  if (plan !== 'creator_pro') return false

  const requirement = PERSONAL_PUBLISH_REQUIREMENTS[capability]
  return Boolean(requirement && verifications.includes(requirement))
}

function expectedOrganizationCapability(
  plan: PlanCode,
  role: OrganizationAccessRole,
  verified: boolean,
  capability: Capability,
) {
  if (!verified) return false
  if (plan !== 'organization_pro') return false

  return ORGANIZATION_ROLE_CAPABILITIES[role].includes(capability)
}

describe('central paid capability matrix', () => {
  it.each(PLAN_CODES)('enforces every personal plan and verification combination for %s', (plan) => {
    for (const verifications of VERIFICATION_COMBINATIONS) {
      const access = context({
        personalPlan: plan,
        verifications,
      })

      for (const capability of CAPABILITIES) {
        expect(canUseCapability(access, capability)).toBe(
          expectedPersonalCapability(plan, verifications, capability),
        )
      }
    }
  })

  it.each(PLAN_CODES)('enforces every organization plan, role and verification combination for %s', (plan) => {
    for (const role of ORGANIZATION_ROLES) {
      for (const verified of [false, true]) {
        const access = context({
          verifications: [...VERIFICATION_TYPES],
          organizationMemberships: [{
            companyId: 'company-matrix',
            plan,
            role,
            verified,
            entitlements: [],
          }],
        })

        for (const capability of CAPABILITIES) {
          expect(canUseCapability(access, capability, { companyId: 'company-matrix' })).toBe(
            expectedOrganizationCapability(plan, role, verified, capability),
          )
        }
      }
    }
  })

  it('keeps organization-scoped grants inside the selected organization role', () => {
    const access = context({
      organizationMemberships: [{
        companyId: 'company-1',
        plan: 'free',
        role: 'recruiter',
        verified: true,
        entitlements: ['job.publish', 'event.publish', 'analytics.view'],
      }],
    })

    expect(canUseCapability(access, 'job.publish', { companyId: 'company-1' })).toBe(true)
    expect(canUseCapability(access, 'event.publish', { companyId: 'company-1' })).toBe(false)
    expect(canUseCapability(access, 'analytics.view', { companyId: 'company-1' })).toBe(false)
    expect(canUseCapability(access, 'job.publish', { companyId: 'company-2' })).toBe(false)
  })
})
