import { describe, expect, it, vi } from 'vitest'
import { createOrganizationLinkRepository, listableOrganizationSql } from './organization-link-repository'

type QueryCall = [text: string, values?: readonly unknown[]]

const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '11111111-1111-4111-8111-111111111111'

function callsOf(query: { mock: { calls: unknown[] } }): QueryCall[] {
  return query.mock.calls as unknown as QueryCall[]
}

function organizationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ORGANIZATION_ID,
    slug: 'oceanic-ship-management',
    name: 'Oceanic Ship Management',
    has_logo: true,
    is_verified: true,
    company_type: 'Ship management',
    organization_type: 'ship_manager',
    office_locations: ['', 'Mumbai, India'],
    ...overrides,
  }
}

describe('listable organization rule', () => {
  it('lists verified organizations and legacy pages, never pending, rejected or suspended applications', () => {
    const sql = listableOrganizationSql('c')
    expect(sql).toContain('coalesce(c.is_verified, false)')
    expect(sql).toContain('where listing_application.company_id = c.id')
    expect(sql).toContain("blocked_application.status <> 'approved'")
  })
})

describe('organization link repository', () => {
  it('searches only listable organizations and returns only picker fields', async () => {
    const query = vi.fn(async () => [organizationRow()])
    const repository = createOrganizationLinkRepository({ query })

    const results = await repository.searchListableOrganizations('  Oceanic  ship ')

    const [text, values] = callsOf(query)[0] ?? []
    expect(text).toContain(listableOrganizationSql('c'))
    expect(text).toContain("c.name ilike $1 escape '\\'")
    expect(values).toEqual(['%Oceanic ship%', 'Oceanic ship%', 'Oceanic ship', 8])
    expect(results).toEqual([{
      id: ORGANIZATION_ID,
      slug: 'oceanic-ship-management',
      name: 'Oceanic Ship Management',
      logoUrl: `/api/company-logo/${ORGANIZATION_ID}`,
      verified: true,
      type: 'Ship manager',
      location: 'Mumbai, India',
    }])
  })

  it('escapes LIKE wildcards so a search cannot match everything', async () => {
    const query = vi.fn(async () => [])
    const repository = createOrganizationLinkRepository({ query })

    await repository.searchListableOrganizations('100%_ma\\rine')

    expect(callsOf(query)[0]?.[1]?.[0]).toBe('%100\\%\\_ma\\\\rine%')
  })

  it('does not query for terms shorter than two characters', async () => {
    const query = vi.fn(async () => [])
    const repository = createOrganizationLinkRepository({ query })

    await expect(repository.searchListableOrganizations(' a ')).resolves.toEqual([])
    expect(query).not.toHaveBeenCalled()
  })

  it('returns an organization by id only when it is listable', async () => {
    const query = vi.fn(async () => [organizationRow({ has_logo: false, is_verified: false })])
    const repository = createOrganizationLinkRepository({ query })

    await expect(repository.getListableOrganization(ORGANIZATION_ID)).resolves.toEqual({
      id: ORGANIZATION_ID,
      slug: 'oceanic-ship-management',
      name: 'Oceanic Ship Management',
      logoUrl: null,
      verified: false,
    })
    const [text, values] = callsOf(query)[0] ?? []
    expect(text).toContain('where c.id = $1')
    expect(text).toContain(listableOrganizationSql('c'))
    expect(values).toEqual([ORGANIZATION_ID])

    query.mockResolvedValueOnce([])
    await expect(repository.getListableOrganization(ORGANIZATION_ID)).resolves.toBeNull()
  })

  it('lists the member approved organizations with logo and role', async () => {
    const query = vi.fn(async () => [organizationRow({ member_role: 'administrator' }), organizationRow({ id: 'b', member_role: 'unknown' })])
    const repository = createOrganizationLinkRepository({ query })

    const organizations = await repository.listMemberOrganizations(USER_ID)

    const [text, values] = callsOf(query)[0] ?? []
    expect(text).toContain('cm.approved_at is not null')
    expect(values).toEqual([USER_ID])
    expect(organizations[0]).toMatchObject({ slug: 'oceanic-ship-management', role: 'administrator', logoUrl: `/api/company-logo/${ORGANIZATION_ID}` })
    expect(organizations[1]?.role).toBe('member')
  })
})
