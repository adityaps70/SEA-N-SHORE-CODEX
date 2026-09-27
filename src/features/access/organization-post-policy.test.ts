import { describe, expect, it } from 'vitest'
import {
  CAPABILITIES,
  canPostAsOrganization,
  canUseOrganizationRoleCapability,
  organizationsMemberCanPostFor,
  type AccessContext,
  type OrganizationAccessMembership,
  type OrganizationAccessRole,
} from './policy'

function membership(overrides: Partial<OrganizationAccessMembership> = {}): OrganizationAccessMembership {
  return {
    companyId: 'company-1',
    plan: 'free',
    role: 'owner',
    verified: true,
    entitlements: [],
    ...overrides,
  }
}

function context(memberships: OrganizationAccessMembership[], accountActive = true): AccessContext {
  return {
    personalPlan: 'free',
    personalEntitlements: ['job.apply', 'event.attend', 'course.enroll'],
    verifications: [],
    organizationMemberships: memberships,
    accountActive,
  }
}

describe('posting as an organization', () => {
  it('lets owners, administrators and content managers of a verified organization post without a paid plan', () => {
    for (const role of ['owner', 'administrator', 'content_manager'] as OrganizationAccessRole[]) {
      expect(canPostAsOrganization(context([membership({ role })]), 'company-1')).toBe(true)
    }
  })

  it('keeps other roles, unverified organizations, other organizations and suspended accounts out', () => {
    for (const role of ['recruiter', 'lms_manager', 'event_manager', 'analyst', 'member'] as OrganizationAccessRole[]) {
      expect(canPostAsOrganization(context([membership({ role })]), 'company-1')).toBe(false)
    }
    expect(canPostAsOrganization(context([membership({ verified: false })]), 'company-1')).toBe(false)
    expect(canPostAsOrganization(context([membership()]), 'company-2')).toBe(false)
    expect(canPostAsOrganization(context([membership()], false), 'company-1')).toBe(false)
    expect(canPostAsOrganization(context([membership()]), '')).toBe(false)
  })

  it('lets only owners and administrators manage every post of their organization', () => {
    expect(canUseOrganizationRoleCapability(context([membership({ role: 'administrator' })]), 'organization.manage_posts', 'company-1')).toBe(true)
    expect(canUseOrganizationRoleCapability(context([membership({ role: 'owner', verified: false })]), 'organization.manage_posts', 'company-1')).toBe(true)
    expect(canUseOrganizationRoleCapability(context([membership({ role: 'content_manager' })]), 'organization.manage_posts', 'company-1')).toBe(false)
  })

  it('lists only the organizations the member can post for', () => {
    const access = context([
      membership({ companyId: 'company-1', role: 'owner' }),
      membership({ companyId: 'company-2', role: 'recruiter' }),
      membership({ companyId: 'company-3', role: 'content_manager' }),
      membership({ companyId: 'company-4', role: 'administrator', verified: false }),
    ])
    expect(organizationsMemberCanPostFor(access)).toEqual(['company-1', 'company-3'])
  })

  it('does not add role capabilities to the plan entitlement list stored in the database', () => {
    expect(CAPABILITIES).not.toContain('organization.post')
  })
})
