import { describe, expect, it } from 'vitest'
import { buildEventPublisherOptions } from './publishers'
import type { AccessContext, Capability, PlanCode } from '@/features/access/policy'
import type { UserOrganizationMembershipSummary } from '@/features/organizations/repository'

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

function access(overrides: Partial<AccessContext> = {}): AccessContext {
  const personalPlan = overrides.personalPlan ?? 'free'
  const organizationMemberships = (overrides.organizationMemberships ?? []).map((membership) => ({
    ...membership,
    entitlements: membership.entitlements.length
      ? membership.entitlements
      : TEST_PLAN_ENTITLEMENTS[membership.plan],
  }))

  return {
    personalPlan,
    personalEntitlements: overrides.personalEntitlements ?? TEST_PLAN_ENTITLEMENTS[personalPlan],
    verifications: overrides.verifications ?? [],
    organizationMemberships,
    accountActive: overrides.accountActive ?? true,
  }
}

const personal = {
  profileId: 'user-1',
  name: 'Asha Singh',
}

const organizations: UserOrganizationMembershipSummary[] = [{
  id: 'company-1',
  name: 'Oceanic Shipping',
  slug: 'oceanic',
  verified: true,
  role: 'event_manager',
}]

describe('event publish-as identities', () => {
  it('keeps a verified free event host visible behind Creator Pro', () => {
    const options = buildEventPublisherOptions(
      access({ verifications: ['event_host'] }),
      personal,
      [],
    )

    expect(options).toEqual([expect.objectContaining({
      key: 'personal:user-1',
      kind: 'personal',
      verified: true,
      canPublish: false,
      blocker: 'upgrade_required',
    })])
  })

  it('allows a verified Creator Pro event host to publish personally', () => {
    const options = buildEventPublisherOptions(
      access({ personalPlan: 'creator_pro', verifications: ['event_host'] }),
      personal,
      [],
    )

    expect(options[0]).toMatchObject({
      kind: 'personal',
      canPublish: true,
      blocker: null,
    })
  })

  it('does not let Creator Pro bypass event-host verification', () => {
    const options = buildEventPublisherOptions(
      access({ personalPlan: 'creator_pro' }),
      personal,
      [],
    )

    expect(options[0]).toMatchObject({
      verified: false,
      canPublish: false,
      blocker: 'verification_required',
    })
  })

  it('allows an Organization Pro event manager to publish for the organization', () => {
    const options = buildEventPublisherOptions(
      access({
        organizationMemberships: [{
          companyId: 'company-1',
          plan: 'organization_pro',
          role: 'event_manager',
          verified: true,
          entitlements: [],
        }],
      }),
      personal,
      organizations,
    )

    expect(options.find((option) => option.kind === 'organization')).toMatchObject({
      key: 'organization:company-1',
      name: 'Oceanic Shipping',
      role: 'event_manager',
      canPublish: true,
      blocker: null,
    })
  })

  it('keeps a verified free organization event manager visible with an upgrade blocker', () => {
    const options = buildEventPublisherOptions(
      access({
        organizationMemberships: [{
          companyId: 'company-1',
          plan: 'free',
          role: 'event_manager',
          verified: true,
          entitlements: [],
        }],
      }),
      personal,
      organizations,
    )

    expect(options.find((option) => option.kind === 'organization')).toMatchObject({
      canPublish: false,
      blocker: 'upgrade_required',
    })
  })

  it('excludes organization memberships that do not carry event publishing responsibility', () => {
    const options = buildEventPublisherOptions(
      access({
        organizationMemberships: [{
          companyId: 'company-1',
          plan: 'organization_pro',
          role: 'recruiter',
          verified: true,
          entitlements: [],
        }],
      }),
      personal,
      [{ ...organizations[0], role: 'recruiter' }],
    )

    expect(options.some((option) => option.kind === 'organization')).toBe(false)
  })

  it('returns personal and every eligible organization identity for Publish as', () => {
    const options = buildEventPublisherOptions(
      access({
        personalPlan: 'creator_pro',
        verifications: ['event_host'],
        organizationMemberships: [{
          companyId: 'company-1',
          plan: 'organization_pro',
          role: 'administrator',
          verified: true,
          entitlements: [],
        }],
      }),
      personal,
      [{ ...organizations[0], role: 'administrator' }],
    )

    expect(options.map((option) => option.key)).toEqual([
      'personal:user-1',
      'organization:company-1',
    ])
    expect(options.every((option) => option.canPublish)).toBe(true)
  })
})
