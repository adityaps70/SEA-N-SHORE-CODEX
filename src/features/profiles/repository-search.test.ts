import { describe, expect, it, vi } from 'vitest'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'

function profileRow() {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'captain-ananya-rao',
    profile_type: 'seafarer',
    full_name: 'Captain Ananya Rao',
    avatar_path: null,
    location: 'Mumbai, India',
    headline: 'Master Mariner',
    summary: 'Tanker professional',
    maritime_profiles: {
      rank: 'Master',
      current_company: 'Oceanic Shipping',
      current_vessel: null,
      sailing_experience_years: 14,
      vessel_types: ['Oil Tanker'],
      trading_areas: ['Asia'],
      shore_career_preference: false,
      availability: null,
    },
    profile_skills: [{ skill: 'SIRE 2.0' }],
  }
}

describe('Aurora professional search', () => {
  it('searches all tokens in Aurora while keeping self and block exclusion', async () => {
    const query = vi.fn(async () => [profileRow()])
    const { createProfileRepository } = await import('./repository')
    const repository = createProfileRepository({ query })

    const result = await repository.getDiscoveryCandidates({
      viewerProfileId: VIEWER_ID,
      limit: 30,
      searchQuery: '  Master   Tanker  ',
    })

    expect(result).toHaveLength(1)
    const [sql, values] = query.mock.calls[0] as unknown as [string, readonly unknown[]]
    expect(sql).toContain('p.id <> $1')
    expect(sql).toContain('from public.user_blocks')
    expect(sql).toContain('like all($2::text[])')
    expect(sql).toContain('limit $3')
    expect(sql).toContain('string_agg(ps_search.skill')
    expect(values).toEqual([VIEWER_ID, ['%master%', '%tanker%'], 30])
  })

  it('keeps the normal recommendation query unchanged when search is blank', async () => {
    const query = vi.fn(async () => [])
    const { createProfileRepository } = await import('./repository')
    const repository = createProfileRepository({ query })

    await repository.getDiscoveryCandidates({
      viewerProfileId: VIEWER_ID,
      limit: 18,
      searchQuery: '   ',
    })

    const [sql, values] = query.mock.calls[0] as unknown as [string, readonly unknown[]]
    expect(sql).not.toContain('like all($2::text[])')
    expect(sql).toContain('limit $2')
    expect(values).toEqual([VIEWER_ID, 18])
  })
})
