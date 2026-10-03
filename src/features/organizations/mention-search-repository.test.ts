import { describe, expect, it, vi } from 'vitest'
import { createOrganizationMentionSearchRepository, likeLiteral, organizationMentionSubtitle } from './mention-search-repository'

type QueryCall = [text: string, values?: readonly unknown[]]

describe('organization mention search repository', () => {
  it('returns nothing without a search term and never hits the database', async () => {
    const query = vi.fn(async () => [])
    const repository = createOrganizationMentionSearchRepository({ query })
    await expect(repository.searchMentionableOrganizations('   ')).resolves.toEqual([])
    await expect(repository.searchMentionableOrganizations('@')).resolves.toEqual([])
    expect(query).not.toHaveBeenCalled()
  })

  it('offers verified or claimed, non-suspended organizations, prefix matches first, at most five', async () => {
    const query = vi.fn(async () => [
      { id: 'org-1', slug: 'sire-marine', name: 'SIRE Marine', logo_path: 'companies/org-1/logo-abc.png', company_type: null, organization_type: 'ship_manager', office_locations: ['Chennai', 'Singapore'], is_verified: true },
      { id: 'org-2', slug: 'oceanic', name: 'Oceanic Ship Management', logo_path: null, company_type: 'Crewing agency', organization_type: null, office_locations: [], is_verified: false },
    ])
    const repository = createOrganizationMentionSearchRepository({ query })

    const results = await repository.searchMentionableOrganizations('si_re')

    const [sql, values] = query.mock.calls[0] as unknown as QueryCall
    const normalized = sql.replace(/\s+/g, ' ')
    expect(normalized).toContain('from public.companies c')
    expect(normalized).toContain("c.name ilike $1 escape '\\'")
    expect(normalized).toContain("coalesce(c.is_verified, false) or coalesce(to_jsonb(c) ->> 'claim_status', 'claimed') = 'claimed'")
    expect(normalized).toContain("oa.status = 'suspended'")
    expect(normalized).toContain("order by (c.name ilike $2 escape '\\') desc")
    expect(normalized).toContain('limit $3')
    expect(values).toEqual(['%si\\_re%', 'si\\_re%', 5])

    expect(results).toEqual([
      { id: 'org-1', slug: 'sire-marine', name: 'SIRE Marine', logoUrl: expect.stringMatching(/^\/api\/company-logo\/org-1\?v=/), subtitle: expect.stringContaining('· Chennai'), verified: true },
      { id: 'org-2', slug: 'oceanic', name: 'Oceanic Ship Management', logoUrl: null, subtitle: 'Crewing agency', verified: false },
    ])
  })

  it('caps the limit between 1 and 20 and strips a leading @', async () => {
    const query = vi.fn(async () => [])
    const repository = createOrganizationMentionSearchRepository({ query })
    await repository.searchMentionableOrganizations('@Sea', 50)
    const [, values] = query.mock.calls[0] as unknown as QueryCall
    expect(values).toEqual(['%Sea%', 'Sea%', 20])
  })

  it('escapes LIKE wildcards and builds a type · location subtitle', () => {
    expect(likeLiteral('100%_sure\\')).toBe('100\\%\\_sure\\\\')
    expect(organizationMentionSubtitle({ company_type: null, organization_type: null, office_locations: null })).toBeNull()
    expect(organizationMentionSubtitle({ company_type: 'Port agent', organization_type: null, office_locations: [' Mumbai '] })).toBe('Port agent · Mumbai')
  })
})
