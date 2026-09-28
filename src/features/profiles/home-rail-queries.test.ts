import { describe, expect, it, vi } from 'vitest'
import type { AccessContext } from '@/features/access/policy'
import type { UserOrganizationState } from '@/features/organizations/types'

vi.mock('@/features/access/server', () => ({ getAccessContext: vi.fn() }))
vi.mock('@/features/organizations/repository', () => ({ organizationRepository: { getUserOrganizationState: vi.fn() } }))
vi.mock('./organization-link-repository', () => ({ organizationLinkRepository: { listMemberOrganizations: vi.fn() } }))

import { createHomeRailQueries, homeOrganizationApplication } from './home-rail-queries'

const USER_ID = '11111111-1111-4111-8111-111111111111'

function access(verifications: AccessContext['verifications'], organizationMemberships: AccessContext['organizationMemberships'] = []): AccessContext {
  return { personalPlan: 'free', personalEntitlements: [], verifications, organizationMemberships, accountActive: true }
}

function application(status: 'pending' | 'changes_requested' | 'rejected' | 'suspended' | 'approved', companyId = 'c-1'): UserOrganizationState {
  return {
    kind: 'application',
    applicationId: 'app-1',
    status,
    submittedAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    adminReviewNote: null,
    company: { id: companyId, slug: 'blue-anchor', name: 'Blue Anchor Marine', verified: false },
    membership: null,
  }
}

const membership = {
  id: 'c-2',
  slug: 'oceanic-ship-management',
  name: 'Oceanic Ship Management',
  logoUrl: null,
  verified: true,
  role: 'owner' as const,
}

describe('home rail queries', () => {
  it('marks a member verified only with an approved verification', async () => {
    const queries = createHomeRailQueries({
      getAccessContext: vi.fn(async () => access(['recruiter'])),
      listMemberOrganizations: vi.fn(async () => [membership]),
      getUserOrganizationState: vi.fn(async () => ({ kind: 'none' as const })),
    })

    await expect(queries.getHomeRailData(USER_ID)).resolves.toEqual({
      verified: true,
      organizations: { memberships: [{ ...membership, plan: 'free', canUpgrade: false }], application: null },
    })
  })

  it('adds each organization plan and whether this member can upgrade it', async () => {
    const other = { ...membership, id: 'c-3', slug: 'harbour-crew', name: 'Harbour Crew', role: 'recruiter' as const }
    const queries = createHomeRailQueries({
      getAccessContext: vi.fn(async () => access([], [
        { companyId: 'c-2', plan: 'free', role: 'owner', verified: true, entitlements: [] },
        { companyId: 'c-3', plan: 'organization_pro', role: 'recruiter', verified: true, entitlements: [] },
      ])),
      listMemberOrganizations: vi.fn(async () => [membership, other]),
      getUserOrganizationState: vi.fn(async () => ({ kind: 'none' as const })),
    })

    const data = await queries.getHomeRailData(USER_ID)
    expect(data.organizations?.memberships.map((entry) => [entry.id, entry.plan, entry.canUpgrade])).toEqual([
      ['c-2', 'free', true],
      ['c-3', 'organization_pro', false],
    ])
  })

  it('degrades to unverified and a load failure instead of breaking Home', async () => {
    const queries = createHomeRailQueries({
      getAccessContext: vi.fn(async () => { throw new Error('db down') }),
      listMemberOrganizations: vi.fn(async () => { throw new Error('db down') }),
      getUserOrganizationState: vi.fn(async () => ({ kind: 'none' as const })),
    })

    await expect(queries.getHomeRailData(USER_ID)).resolves.toEqual({ verified: false, organizations: null })
  })

  it('shows a pending or returned application with a link to act on it', () => {
    expect(homeOrganizationApplication(application('pending'), [])).toEqual({
      companyName: 'Blue Anchor Marine',
      status: 'pending',
      statusLabel: 'Sea N Shore is reviewing',
      href: '/organizations#your-organizations',
      linkLabel: 'View application',
    })
    expect(homeOrganizationApplication(application('changes_requested'), [])).toMatchObject({
      href: '/organizations#update-application',
      linkLabel: 'Update application',
    })
    expect(homeOrganizationApplication(application('approved'), [])).toBeNull()
    expect(homeOrganizationApplication(application('pending', membership.id), [membership])).toBeNull()
    expect(homeOrganizationApplication({ kind: 'none' }, [])).toBeNull()
  })
})
