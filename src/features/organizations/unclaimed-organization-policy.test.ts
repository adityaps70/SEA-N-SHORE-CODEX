import { describe, expect, it, vi } from 'vitest'
import {
  canPostAsOrganization,
  canUseCapability,
  canUseOrganizationRoleCapability,
  organizationsMemberCanPostFor,
  type AccessContext,
  type OrganizationAccessMembership,
} from '@/features/access/policy'
import { createAccessRepository } from '@/features/access/repository'
import {
  organizationClaimStatusSql,
  organizationNameKey,
  sameOrganizationName,
  unclaimedOrganizationSchema,
  unclaimedOrganizationSlug,
} from './unclaimed-organization-policy'

function context(memberships: OrganizationAccessMembership[]): AccessContext {
  return {
    personalPlan: 'free',
    personalEntitlements: [],
    verifications: [],
    organizationMemberships: memberships,
    accountActive: true,
  }
}

const proEntitlements = [
  'job.publish', 'event.publish', 'course.publish', 'job.manage_applicants', 'event.manage_attendees',
  'course.manage_students', 'organization.manage', 'organization.team', 'organization.branding', 'analytics.view',
] as OrganizationAccessMembership['entitlements']

describe('unclaimed organizations cannot publish', () => {
  it('denies jobs, events, courses and organization posts for an unclaimed page, even with plan entitlements', () => {
    const access = context([
      { companyId: 'claimed', plan: 'organization_pro', role: 'owner', verified: true, entitlements: proEntitlements },
      { companyId: 'unclaimed', plan: 'organization_pro', role: 'owner', verified: true, unclaimed: true, entitlements: proEntitlements },
    ])

    for (const capability of ['job.publish', 'event.publish', 'course.publish'] as const) {
      expect(canUseCapability(access, capability, { companyId: 'claimed' })).toBe(true)
      expect(canUseCapability(access, capability, { companyId: 'unclaimed' })).toBe(false)
    }
    expect(canPostAsOrganization(access, 'claimed')).toBe(true)
    expect(canPostAsOrganization(access, 'unclaimed')).toBe(false)
    expect(canUseOrganizationRoleCapability(access, 'organization.manage_posts', 'unclaimed')).toBe(false)
    expect(organizationsMemberCanPostFor(access)).toEqual(['claimed'])
  })

  it('reads the claim status in the access context without needing the new column to exist', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes('from public.company_members cm')) {
        return [
          { company_id: 'a', company_verified: true, company_claim_status: 'unclaimed', role: 'owner', plan_code: null, entitlements: [] },
          { company_id: 'b', company_verified: true, company_claim_status: 'claimed', role: 'owner', plan_code: null, entitlements: [] },
        ]
      }
      if (text.includes('account_status')) return [{ account_status: 'active' }]
      return []
    })
    const access = await createAccessRepository({ query }).getAccessContext('user-1')

    const membershipQuery = query.mock.calls.map(([text]) => text).find((text) => text.includes('from public.company_members cm'))
    expect(membershipQuery).toContain("coalesce(to_jsonb(c) ->> 'claim_status', 'claimed') as company_claim_status")
    expect(access.organizationMemberships.map((membership) => [membership.companyId, membership.unclaimed])).toEqual([['a', true], ['b', false]])
  })
})

describe('unclaimed organization helpers', () => {
  it('reads the claim status defensively from the row', () => {
    expect(organizationClaimStatusSql('c')).toBe("coalesce(to_jsonb(c) ->> 'claim_status', 'claimed')")
  })

  it('compares organization names case-insensitively with spaces collapsed', () => {
    expect(organizationNameKey('  Oceanic   Ship  Management ')).toBe('oceanic ship management')
    expect(sameOrganizationName('OCEANIC ship management', 'Oceanic Ship  Management')).toBe(true)
    expect(sameOrganizationName('Oceanic', 'Oceanic Ltd')).toBe(false)
    expect(sameOrganizationName('', '')).toBe(false)
  })

  it('validates the "I just work there" form and normalizes the website', () => {
    const parsed = unclaimedOrganizationSchema.parse({ name: '  Blue   Anchor ', organizationType: 'ship_manager', location: ' Kochi,  India ', website: 'blueanchor.example' })
    expect(parsed).toEqual({ name: 'Blue Anchor', organizationType: 'ship_manager', location: 'Kochi, India', website: 'https://blueanchor.example' })
    expect(unclaimedOrganizationSchema.parse({ name: 'Blue Anchor', organizationType: 'other', location: 'Goa', website: '' }).website).toBeNull()

    const invalid = unclaimedOrganizationSchema.safeParse({ name: 'B', organizationType: 'not-a-type', location: '', website: 'not a site' })
    expect(invalid.success).toBe(false)
    const errors = invalid.success ? {} : invalid.error.flatten().fieldErrors
    expect(Object.keys(errors).sort()).toEqual(['location', 'name', 'organizationType', 'website'])
  })

  it('builds a URL-safe slug with a short suffix', () => {
    expect(unclaimedOrganizationSlug('Blue Anchor & Söns', () => 'A1B2-C3D4')).toBe('blue-anchor-sons-a1b2c3')
    expect(unclaimedOrganizationSlug('!!!', () => 'zz')).toBe('organization-zz')
    expect(unclaimedOrganizationSlug('x'.repeat(200), () => 'abcdef')).toHaveLength(80)
  })
})
