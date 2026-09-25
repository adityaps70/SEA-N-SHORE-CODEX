import { describe, expect, it } from 'vitest'
import { buildCoursePublisherOptions } from './publishers'
import type { AccessContext } from '@/features/access/policy'
import type { UserOrganizationMembershipSummary } from '@/features/organizations/repository'

function access(overrides: Partial<AccessContext> = {}): AccessContext {
  return {
    personalPlan: 'free',
    personalEntitlements: [],
    verifications: [],
    organizationMemberships: [],
    accountActive: true,
    ...overrides,
  }
}

const personal = { profileId: 'user-1', name: 'Capt. Asha Singh' }
const organizations: UserOrganizationMembershipSummary[] = [{
  id: 'company-1',
  slug: 'sea-academy',
  name: 'Sea Academy',
  verified: true,
  role: 'lms_manager',
}]

describe('course publish-as identities', () => {
  it('keeps a verified trainer visible behind Creator Pro', () => {
    const options = buildCoursePublisherOptions(access({ verifications: ['trainer'] }), personal, [])
    expect(options[0]).toMatchObject({
      key: 'personal:user-1',
      kind: 'personal',
      verified: true,
      canPublish: false,
      blocker: 'upgrade_required',
    })
  })

  it('allows a verified Creator Pro trainer to publish personally', () => {
    const options = buildCoursePublisherOptions(
      access({ personalPlan: 'creator_pro', verifications: ['trainer'] }),
      personal,
      [],
    )
    expect(options[0]).toMatchObject({ canPublish: true, blocker: null })
  })

  it('does not let Creator Pro bypass trainer verification', () => {
    const options = buildCoursePublisherOptions(access({ personalPlan: 'creator_pro' }), personal, [])
    expect(options[0]).toMatchObject({
      verified: false,
      canPublish: false,
      blocker: 'verification_required',
    })
  })

  it('allows an Organization Pro LMS manager to publish for the organization', () => {
    const options = buildCoursePublisherOptions(
      access({
        organizationMemberships: [{
          companyId: 'company-1',
          plan: 'organization_pro',
          role: 'lms_manager',
          verified: true,
          entitlements: [],
        }],
      }),
      personal,
      organizations,
    )

    expect(options.find((option) => option.kind === 'organization')).toMatchObject({
      key: 'organization:company-1',
      name: 'Sea Academy',
      role: 'lms_manager',
      canPublish: true,
      blocker: null,
    })
  })

  it('keeps a verified free organization LMS manager visible with an upgrade blocker', () => {
    const options = buildCoursePublisherOptions(
      access({
        organizationMemberships: [{
          companyId: 'company-1',
          plan: 'free',
          role: 'lms_manager',
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

  it('excludes organization roles that do not manage LMS authoring', () => {
    const options = buildCoursePublisherOptions(
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
})
