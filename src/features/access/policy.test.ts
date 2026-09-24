import { describe, expect, it } from 'vitest'
import {
  canUseCapability,
  effectiveCapabilities,
  type AccessContext,
} from './policy'

function context(overrides: Partial<AccessContext> = {}): AccessContext {
  return {
    personalPlan: 'free',
    personalEntitlements: [],
    verifications: [],
    organizationMemberships: [],
    accountActive: true,
    ...overrides,
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

  it('denies all paid capabilities when the account is suspended', () => {
    const access = context({
      accountActive: false,
      personalPlan: 'creator_pro',
      verifications: ['recruiter', 'trainer', 'event_host'],
    })

    expect(effectiveCapabilities(access)).not.toContain('job.publish')
    expect(canUseCapability(access, 'job.publish')).toBe(false)
  })
})
