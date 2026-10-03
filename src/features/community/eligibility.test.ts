import { describe, expect, it } from 'vitest'
import type { AccessContext, OrganizationAccessMembership, PlanCode } from '@/features/access/policy'
import { communityCreationEligibility } from './eligibility'

const orgA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const orgB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function membership(overrides: Partial<OrganizationAccessMembership> = {}): OrganizationAccessMembership {
  return { companyId: orgA, plan: 'organization_pro', role: 'owner', verified: true, entitlements: [], ...overrides }
}

function access(personalPlan: PlanCode, organizationMemberships: OrganizationAccessMembership[] = []): Pick<AccessContext, 'personalPlan' | 'organizationMemberships'> {
  return { personalPlan, organizationMemberships }
}

const nobodyOwns = new Map<string, number>()

describe('communityCreationEligibility', () => {
  it('lets a Creator Pro member create their first community', () => {
    const result = communityCreationEligibility({ access: access('creator_pro'), isPlatformAdmin: false, ownedByMember: 0, ownedByOrganization: nobodyOwns })
    expect(result).toEqual({ canCreate: true, reasons: [], asMember: { allowed: true, reason: null }, asOrganizations: [] })
  })

  it('treats a running Creator Pro trial as Creator Pro', () => {
    // `personalPlan` is built from account_subscriptions rows in status trialing/active/past_due,
    // so a member on a free trial arrives here as 'creator_pro' and the rule needs no trial flag.
    const trial = access('creator_pro')
    expect(communityCreationEligibility({ access: trial, isPlatformAdmin: false, ownedByMember: 0, ownedByOrganization: nobodyOwns }).canCreate).toBe(true)
  })

  it('asks free members to get Creator Pro', () => {
    const result = communityCreationEligibility({ access: access('free'), isPlatformAdmin: false, ownedByMember: 0, ownedByOrganization: nobodyOwns })
    expect(result.canCreate).toBe(false)
    expect(result.asMember).toEqual({ allowed: false, reason: 'creator_pro_required' })
    expect(result.reasons).toEqual(['creator_pro_required'])
  })

  it('stops a Creator Pro member at one live community', () => {
    const result = communityCreationEligibility({ access: access('creator_pro'), isPlatformAdmin: false, ownedByMember: 1, ownedByOrganization: nobodyOwns })
    expect(result.canCreate).toBe(false)
    expect(result.asMember).toEqual({ allowed: false, reason: 'limit_reached' })
    expect(result.reasons).toEqual(['limit_reached'])
  })

  it('lets the owner or an administrator of an Organization Pro organization create one for it', () => {
    for (const role of ['owner', 'administrator'] as const) {
      const result = communityCreationEligibility({
        access: access('free', [membership({ role })]), isPlatformAdmin: false, ownedByMember: 0, ownedByOrganization: nobodyOwns,
      })
      expect(result.canCreate).toBe(true)
      expect(result.asMember.allowed).toBe(false)
      expect(result.asOrganizations).toEqual([{ companyId: orgA, allowed: true, reason: null }])
      expect(result.reasons).toEqual([])
    }
  })

  it('does not let recruiters or plain members create for an Organization Pro organization', () => {
    const result = communityCreationEligibility({
      access: access('free', [membership({ role: 'recruiter' }), membership({ companyId: orgB, role: 'member' })]),
      isPlatformAdmin: false, ownedByMember: 0, ownedByOrganization: nobodyOwns,
    })
    expect(result.canCreate).toBe(false)
    expect(result.asOrganizations).toEqual([
      { companyId: orgA, allowed: false, reason: 'not_admin' },
      { companyId: orgB, allowed: false, reason: 'not_admin' },
    ])
    expect(result.reasons).toEqual(['creator_pro_required', 'not_admin'])
  })

  it('requires Organization Pro, verification and a claimed page for the organization option', () => {
    const cases: Array<Partial<OrganizationAccessMembership>> = [{ plan: 'free' }, { verified: false }, { unclaimed: true }]
    for (const overrides of cases) {
      const result = communityCreationEligibility({
        access: access('free', [membership(overrides)]), isPlatformAdmin: false, ownedByMember: 0, ownedByOrganization: nobodyOwns,
      })
      expect(result.asOrganizations).toEqual([{ companyId: orgA, allowed: false, reason: 'organization_pro_required' }])
      expect(result.canCreate).toBe(false)
    }
  })

  it('stops an organization at one live community while other organizations stay open', () => {
    const result = communityCreationEligibility({
      access: access('free', [membership(), membership({ companyId: orgB })]),
      isPlatformAdmin: false, ownedByMember: 0, ownedByOrganization: new Map([[orgA, 1]]),
    })
    expect(result.asOrganizations).toEqual([
      { companyId: orgA, allowed: false, reason: 'limit_reached' },
      { companyId: orgB, allowed: true, reason: null },
    ])
    expect(result.canCreate).toBe(true)
  })

  it('lists every blocking reason once when nothing is allowed', () => {
    const result = communityCreationEligibility({
      access: access('creator_pro', [membership(), membership({ companyId: orgB, plan: 'free' })]),
      isPlatformAdmin: false, ownedByMember: 1, ownedByOrganization: new Map([[orgA, 1]]),
    })
    expect(result.canCreate).toBe(false)
    expect(result.reasons).toEqual(['limit_reached', 'organization_pro_required'])
  })

  it('exempts Sea N Shore administrators from plans and limits, for themselves and their organizations', () => {
    const result = communityCreationEligibility({
      access: access('free', [membership({ plan: 'free', role: 'member', verified: false })]),
      isPlatformAdmin: true, ownedByMember: 5, ownedByOrganization: new Map([[orgA, 3]]),
    })
    expect(result).toEqual({
      canCreate: true,
      reasons: [],
      asMember: { allowed: true, reason: null },
      asOrganizations: [{ companyId: orgA, allowed: true, reason: null }],
    })
  })
})
