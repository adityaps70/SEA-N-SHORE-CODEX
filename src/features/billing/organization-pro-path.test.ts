import { describe, expect, it } from 'vitest'
import type { AccessContext, OrganizationAccessMembership } from '@/features/access/policy'
import type { UserOrganizationState } from '@/features/organizations/types'
import {
  ORGANIZATION_PRO_CHOOSER_HREF,
  organizationProCallToAction,
  organizationProCandidates,
  resolveOrganizationProPath,
} from './organization-pro-path'

const OCEANIC = { id: '11111111-1111-4111-8111-111111111111', slug: 'oceanic-ship-management', name: 'Oceanic Ship Management' }
const HARBOUR = { id: '22222222-2222-4222-8222-222222222222', slug: 'harbour-crew', name: 'Harbour Crew Services' }

function membership(companyId: string, overrides: Partial<OrganizationAccessMembership> = {}): OrganizationAccessMembership {
  return { companyId, plan: 'free', role: 'owner', verified: true, entitlements: [], ...overrides }
}

function access(memberships: OrganizationAccessMembership[], accountActive = true): AccessContext {
  return { personalPlan: 'free', personalEntitlements: [], verifications: [], organizationMemberships: memberships, accountActive }
}

const none: UserOrganizationState = { kind: 'none' }

function application(status: 'pending' | 'changes_requested' | 'rejected' | 'suspended' | 'approved'): UserOrganizationState {
  return {
    kind: 'application',
    applicationId: 'app-1',
    status,
    submittedAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-21T10:00:00.000Z',
    adminReviewNote: null,
    company: { id: '33333333-3333-4333-8333-333333333333', slug: 'blue-anchor', name: 'Blue Anchor Marine', verified: false },
    membership: null,
  }
}

describe('resolveOrganizationProPath', () => {
  it('goes straight to the checkout of the one verified organization the member owns', () => {
    const path = resolveOrganizationProPath({ access: access([membership(OCEANIC.id)]), organizations: [OCEANIC], application: none })
    expect(path).toMatchObject({
      kind: 'single',
      href: `/settings/billing/organizations/${OCEANIC.id}?plan=organization_pro#organization-pro`,
      organization: { id: OCEANIC.id, name: 'Oceanic Ship Management', role: 'owner', plan: 'free' },
    })
  })

  it('treats an administrator like an owner and ignores organizations where they are only a member', () => {
    const path = resolveOrganizationProPath({
      access: access([membership(OCEANIC.id, { role: 'administrator' }), membership(HARBOUR.id, { role: 'recruiter' })]),
      organizations: [OCEANIC, HARBOUR],
      application: none,
    })
    expect(path.kind).toBe('single')
    expect(path.href).toContain(OCEANIC.id)
  })

  it('sends a member with several verified organizations to the chooser', () => {
    const path = resolveOrganizationProPath({
      access: access([membership(OCEANIC.id), membership(HARBOUR.id, { role: 'administrator', plan: 'organization_pro' })]),
      organizations: [OCEANIC, HARBOUR],
      application: none,
    })
    expect(path).toMatchObject({ kind: 'choose', href: ORGANIZATION_PRO_CHOOSER_HREF })
    expect(path.kind === 'choose' && path.organizations.map((organization) => organization.name)).toEqual(['Oceanic Ship Management', 'Harbour Crew Services'])
  })

  it('explains verification for an organization that is still being verified, with its status link', () => {
    const pending = resolveOrganizationProPath({ access: access([]), organizations: [], application: application('pending') })
    expect(pending).toEqual({
      kind: 'unverified',
      href: ORGANIZATION_PRO_CHOOSER_HREF,
      organizationName: 'Blue Anchor Marine',
      statusHref: '/organizations#your-pages',
      status: 'pending',
    })
    expect(resolveOrganizationProPath({ access: access([]), organizations: [], application: application('changes_requested') }))
      .toMatchObject({ kind: 'unverified', statusHref: '/organizations#update-application', status: 'changes_requested' })
  })

  it('treats an owned organization without the verified badge as unverified', () => {
    const path = resolveOrganizationProPath({ access: access([membership(OCEANIC.id, { verified: false })]), organizations: [OCEANIC], application: none })
    expect(path).toMatchObject({ kind: 'unverified', organizationName: 'Oceanic Ship Management', status: 'not_verified' })
  })

  it('tells an ordinary member who can buy it', () => {
    const path = resolveOrganizationProPath({ access: access([membership(HARBOUR.id, { role: 'member' })]), organizations: [HARBOUR], application: none })
    expect(path).toEqual({ kind: 'member_only', href: ORGANIZATION_PRO_CHOOSER_HREF, organizationNames: ['Harbour Crew Services'] })
  })

  it('offers to create an organization page when the member has none', () => {
    expect(resolveOrganizationProPath({ access: access([]), organizations: [], application: none }))
      .toEqual({ kind: 'none', href: ORGANIZATION_PRO_CHOOSER_HREF, createHref: '/organizations?register=1#register-organization' })
    // An approved application is not "waiting".
    expect(resolveOrganizationProPath({ access: access([]), organizations: [], application: application('approved') }).kind).toBe('none')
  })

  it('never offers checkout to a restricted account', () => {
    expect(resolveOrganizationProPath({ access: access([membership(OCEANIC.id)], false), organizations: [OCEANIC], application: none }).kind).toBe('restricted')
  })
})

describe('organizationProCandidates', () => {
  it('keeps only owner and administrator organizations, with plan and verification from access', () => {
    expect(organizationProCandidates(
      access([membership(OCEANIC.id, { plan: 'organization_pro' }), membership(HARBOUR.id, { role: 'analyst' })]),
      [OCEANIC, HARBOUR, { id: 'not-approved', slug: 'x', name: 'X' }],
    )).toEqual([{ ...OCEANIC, role: 'owner', verified: true, plan: 'organization_pro' }])
  })
})

describe('organizationProCallToAction', () => {
  it('names the organization on the Plans page button for a single organization', () => {
    const path = resolveOrganizationProPath({ access: access([membership(OCEANIC.id)]), organizations: [OCEANIC], application: none })
    expect(organizationProCallToAction(path)).toEqual({
      href: `/settings/billing/organizations/${OCEANIC.id}?plan=organization_pro#organization-pro`,
      label: 'Get Organization Pro',
      note: 'For Oceanic Ship Management. You choose monthly or yearly on the next screen.',
    })
    const pro = resolveOrganizationProPath({ access: access([membership(OCEANIC.id, { plan: 'organization_pro' })]), organizations: [OCEANIC], application: none })
    expect(organizationProCallToAction(pro).label).toBe('Manage Organization Pro')
  })

  it('links the application status when the organization is not verified yet', () => {
    const path = resolveOrganizationProPath({ access: access([]), organizations: [], application: application('pending') })
    expect(organizationProCallToAction(path)).toMatchObject({ href: '/organizations#your-pages', label: 'View verification status' })
    expect(organizationProCallToAction(path).note).toContain('as soon as Sea N Shore verifies it')
  })

  it('offers "Create an organization page" when there is none', () => {
    const path = resolveOrganizationProPath({ access: access([]), organizations: [], application: none })
    expect(organizationProCallToAction(path)).toMatchObject({ href: '/organizations?register=1#register-organization', label: 'Create an organization page' })
  })

  it('sends several organizations to the chooser and members to their organizations', () => {
    const choose = resolveOrganizationProPath({ access: access([membership(OCEANIC.id), membership(HARBOUR.id)]), organizations: [OCEANIC, HARBOUR], application: none })
    expect(organizationProCallToAction(choose)).toMatchObject({ href: ORGANIZATION_PRO_CHOOSER_HREF, note: 'Choose which of your 2 organizations to upgrade.' })
    const member = resolveOrganizationProPath({ access: access([membership(HARBOUR.id, { role: 'member' })]), organizations: [HARBOUR], application: none })
    expect(organizationProCallToAction(member)).toMatchObject({ href: '/organizations#your-pages', label: 'See your organizations' })
  })
})
