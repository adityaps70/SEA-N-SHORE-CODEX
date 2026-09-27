import { describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ query: db.query, withTransaction: vi.fn() }))
vi.mock('@/features/events/event-banner-media', () => ({ resolveEventBannerReference: async (value: string | null) => value }))

import { createOrganizationWorkspaceRepository } from './workspace-repository'
import { createJobsRepository } from '@/features/jobs/repository'
import { createMarketplaceRepository } from '@/features/learning/marketplace-repository'
import { calendarEventRepository } from '@/features/events/calendar-repository'

describe('organization page data (workspace repository)', () => {
  it('maps cover, tagline, company size and specialities, ignoring an unknown size', async () => {
    const row = {
      id: 'company-1', slug: 'oceanic', name: 'Oceanic', logo_path: 'organizations/company-1/logo-a.png', cover_path: 'organizations/company-1/cover-b.jpg',
      tagline: '  Tanker management  ', company_size: '51-200', specialties: ['LNG', 'Crewing'], company_type: 'Ship manager', organization_type: 'ship_manager',
      organization_details: {}, website: null, description: null, fleet_summary: null, vessel_types: [], office_locations: ['Mumbai'], is_verified: true,
    }
    let text = ''
    const repository = createOrganizationWorkspaceRepository({ query: async (sql) => { text = sql; return [row] } })
    await expect(repository.getBySlug('oceanic')).resolves.toMatchObject({
      coverPath: 'organizations/company-1/cover-b.jpg',
      tagline: 'Tanker management',
      companySize: '51-200',
      specialties: ['LNG', 'Crewing'],
    })
    expect(text).toContain('cover_path, tagline, company_size, specialties')

    const odd = createOrganizationWorkspaceRepository({ query: async () => [{ ...row, company_size: 'huge', specialties: null, tagline: '' }] })
    await expect(odd.getBySlug('oceanic')).resolves.toMatchObject({ companySize: null, specialties: [], tagline: null })
  })

  it('saves page details only when the form sends them', async () => {
    const seen: Array<readonly unknown[] | undefined> = []
    const repository = createOrganizationWorkspaceRepository({ query: async (_text, values) => { seen.push(values); return [{ id: 'company-1' }] } })
    const base = { website: null, description: null, fleetSummary: null, vesselTypes: [], officeLocations: [] }
    await repository.updateBranding('company-1', { ...base, tagline: 'Crew care', companySize: '11-50', specialties: ['Welfare'] })
    expect(seen[0]?.slice(7)).toEqual([true, 'Crew care', '11-50', ['Welfare']])
    await repository.updateBranding('company-1', base)
    expect(seen[1]?.[7]).toBe(false)
  })

  it('updates the cover path and reports a missing organization', async () => {
    const repository = createOrganizationWorkspaceRepository({ query: async (text, values) => {
      expect(text).toContain('set cover_path = $2')
      return values?.[0] === 'company-1' ? [{ id: 'company-1' }] : []
    } })
    await expect(repository.updateCoverPath('company-1', 'organizations/company-1/cover-x.webp')).resolves.toBe(true)
    await expect(repository.updateCoverPath('missing', null)).rejects.toThrow('organization_not_found')
  })

  it('returns cards in the requested order with follower counts and the viewer follow state', async () => {
    const repository = createOrganizationWorkspaceRepository({
      query: async (text, values) => {
        expect(text).toContain('company.id = any($2::uuid[])')
        expect(text).toContain('viewer_follow.follower_id = $1')
        expect(values).toEqual(['user-1', ['c2', 'c1']])
        return [
          { id: 'c1', slug: 'a', name: 'A', logo_path: null, cover_path: null, tagline: null, description: 'First line', company_type: 'Crewing Company', organization_type: null, headquarters: 'Mumbai', is_verified: true, follower_count: '7', following: true },
          { id: 'c2', slug: 'b', name: 'B', logo_path: null, cover_path: null, tagline: 'B tagline', description: null, company_type: null, organization_type: 'union', headquarters: null, is_verified: false, follower_count: 0, following: false },
        ]
      },
    })
    const cards = await repository.listOrganizationCards(['c2', 'c1', 'c2'], 'user-1')
    expect(cards.map((card) => card.id)).toEqual(['c2', 'c1'])
    expect(cards[1]).toMatchObject({ companyType: 'Crewing Company', organizationType: 'manning_agency', followerCount: 7, following: true, headquarters: 'Mumbai' })
    const unused = createOrganizationWorkspaceRepository({ query: async () => { throw new Error('should not query') } })
    await expect(unused.listOrganizationCards([], 'user-1')).resolves.toEqual([])
  })

  it('finds similar organizations of the same type, verified first, excluding suspended ones', async () => {
    const repository = createOrganizationWorkspaceRepository({
      query: async (text, values) => {
        expect(text).toContain('company.organization_type = $3')
        expect(text).toContain("suspended_application.status = 'suspended'")
        expect(text).toMatch(/order by coalesce\(company\.is_verified, false\) desc, follower_count desc/)
        expect(values).toEqual(['user-1', 'c1', 'ship_manager', 'Ship manager', 4])
        return []
      },
    })
    await expect(repository.listSimilarOrganizations({ id: 'c1', organizationType: 'ship_manager', companyType: 'Ship manager' }, 'user-1')).resolves.toEqual([])
  })

  it('suggests verified organizations the viewer has not joined or followed', async () => {
    const repository = createOrganizationWorkspaceRepository({
      query: async (text, values) => {
        expect(text).toContain('coalesce(company.is_verified, false) = true')
        expect(text).toContain('discover_member.user_id = $1')
        expect(text).toContain('discover_follow.follower_id = $1')
        expect(values).toEqual(['user-1', 6])
        return []
      },
    })
    await expect(repository.listDiscoverOrganizations('user-1')).resolves.toEqual([])
  })

  it('counts team members and people who list the organization once each, active accounts only', async () => {
    const repository = createOrganizationWorkspaceRepository({
      query: async (text, values) => {
        expect(text).toContain('count(distinct people.profile_id)')
        expect(text).toContain('listed.current_company_id = $1')
        expect(text).toContain('member.approved_at is not null')
        expect(text).toContain("person.account_status = 'active'")
        expect(values).toEqual(['c1'])
        return [{ people_count: '14' }]
      },
    })
    await expect(repository.countPeople('c1')).resolves.toBe(14)
  })

  it('lists people with public fields, team first, hiding blocked profiles', async () => {
    const repository = createOrganizationWorkspaceRepository({
      query: async (text, values) => {
        expect(text).toContain('public.user_blocks')
        expect(text).toContain('distinct on (person.id)')
        expect(text).not.toContain('email')
        expect(values).toEqual(['c1', 'viewer-1', 60])
        return [
          { id: 'p1', full_name: 'Grace', slug: 'grace', headline: 'Counsellor', avatar_path: null, member_role: 'administrator' },
          { id: 'p2', full_name: 'Arjun', slug: null, headline: null, avatar_path: 'a.jpg', member_role: null },
        ]
      },
    })
    await expect(repository.listPeople('c1', 'viewer-1')).resolves.toEqual([
      { id: 'p1', fullName: 'Grace', slug: 'grace', headline: 'Counsellor', avatarPath: null, memberRole: 'administrator' },
      { id: 'p2', fullName: 'Arjun', slug: null, headline: null, avatarPath: 'a.jpg', memberRole: null },
    ])
  })

  it('finds the active owner who receives messages to the organization', async () => {
    const repository = createOrganizationWorkspaceRepository({
      query: async (text) => {
        expect(text).toContain("member.role::text = 'owner'")
        expect(text).toContain("owner_profile.account_status = 'active'")
        return [{ user_id: 'owner-1' }]
      },
    })
    await expect(repository.getContactProfileId('c1')).resolves.toBe('owner-1')
    await expect(createOrganizationWorkspaceRepository({ query: async () => [] }).getContactProfileId('c1')).resolves.toBeNull()
  })
})

describe('organization content from the jobs, events and learning repositories', () => {
  it('lists live jobs posted as the organization', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createJobsRepository({ query: async (text, values) => { seen.push({ text, values }); return [] } })
    await repository.listPublishedJobsForCompany('c1', 500)
    expect(seen[0]?.text).toContain("j.status = 'published'")
    expect(seen[0]?.text).toContain('j.deleted_at is null')
    expect(seen[0]?.text).toContain('j.company_id = $1')
    expect(seen[0]?.values).toEqual(['c1', 100])
  })

  it('lists published catalog courses of the organization', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createMarketplaceRepository({ query: async (text, values) => { seen.push({ text, values }); return [] } })
    await repository.listPublishedCoursesForCompany('c1')
    expect(seen[0]?.text).toContain("course.status = 'published'")
    expect(seen[0]?.text).toContain('course.is_discoverable = true')
    expect(seen[0]?.text).toContain('course.company_id = $1')
    expect(seen[0]?.values).toEqual(['c1', 30])
  })

  it('lists upcoming published events hosted as the organization', async () => {
    db.query.mockResolvedValueOnce([])
    await calendarEventRepository.listOrganizationEvents('viewer-1', 'c1', 2)
    const [text, values] = db.query.mock.calls[0] ?? []
    expect(text).toContain('e.company_id = $2::uuid')
    expect(text).toContain("e.status = 'published'")
    expect(text).toContain('e.end_at > now()')
    expect(values).toEqual(['viewer-1', 'c1', 2])
  })
})
