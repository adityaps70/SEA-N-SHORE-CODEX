import { describe, expect, it, vi } from 'vitest'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'

function profileRow() {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'captain-ananya-rao',
    profile_type: 'seafarer',
    identity_root: 'professional',
    primary_identity: 'Master',
    primary_identity_family: 'Sea-going · Deck',
    secondary_identities: ['Mentor'],
    full_name: 'Captain Ananya Rao',
    avatar_path: null,
    cover_path: null,
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
  it('searches exact identities and all existing professional tokens while keeping self and block exclusion', async () => {
    const query = vi.fn(async () => [profileRow()])
    const { createProfileRepository } = await import('./repository')
    const repository = createProfileRepository({ query })

    const result = await repository.getDiscoveryCandidates({
      viewerProfileId: VIEWER_ID,
      limit: 30,
      searchQuery: '  Master   Tanker  ',
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ primaryIdentity: 'Master', secondaryIdentities: ['Mentor'] })
    const [sql, values] = query.mock.calls[0] as unknown as [string, readonly unknown[]]
    expect(sql).toContain('p.id <> $1')
    expect(sql).toContain('from public.user_blocks')
    // Round 14 (3.6): every token must match the stored search_text (one LIKE per token so the
    // trigram index serves each); the fields it is built from are checked below and in the
    // migration (infra/aws/database/migrations/0067_people_search_text.sql).
    expect(sql).toContain('and p.search_text like ($2::text[])[1]')
    expect(sql).toContain('and p.search_text like ($2::text[])[2]')
    expect(sql).not.toContain('($2::text[])[3]')
    expect(sql).toContain('limit $3')
    expect(sql).toContain('order by p.updated_at desc, p.id asc')
    expect(values).toEqual([VIEWER_ID, ['%master%', '%tanker%'], 30])
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('falls back to the per-query text, with the same fields and tokens, while search_text does not exist yet', async () => {
    const missingColumn = Object.assign(new Error('column p.search_text does not exist'), { code: '42703' })
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('p.search_text')) throw missingColumn
      return [profileRow()]
    })
    const { createProfileRepository } = await import('./repository')
    const repository = createProfileRepository({ query })

    const result = await repository.getDiscoveryCandidates({
      viewerProfileId: VIEWER_ID,
      limit: 30,
      searchQuery: '  Master   Tanker  ',
    })

    expect(result).toHaveLength(1)
    expect(query).toHaveBeenCalledTimes(2)
    const [sql, values] = query.mock.calls[1] as unknown as [string, readonly unknown[]]
    expect(sql).toContain('p.id <> $1')
    expect(sql).toContain('from public.user_blocks')
    expect(sql).toContain('like all($2::text[])')
    expect(sql).toContain('limit $3')
    expect(sql).toContain('string_agg(ps_search.skill')
    expect(sql).toContain('p.primary_identity')
    expect(sql).toContain('p.primary_identity_family')
    expect(sql).toContain("array_to_string(p.secondary_identities, ' ')")
    expect(sql).toContain('order by p.updated_at desc, p.id asc')
    expect(values).toEqual([VIEWER_ID, ['%master%', '%tanker%'], 30])
  })

  it('does not hide other database errors behind the fallback', async () => {
    const query = vi.fn(async () => { throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }) })
    const { createProfileRepository } = await import('./repository')
    const repository = createProfileRepository({ query })

    await expect(repository.getDiscoveryCandidates({ viewerProfileId: VIEWER_ID, limit: 30, searchQuery: 'master' }))
      .rejects.toThrow('statement timeout')
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('binds one LIKE per token, up to the eight-token cap', async () => {
    const query = vi.fn(async () => [])
    const { createProfileRepository } = await import('./repository')
    const repository = createProfileRepository({ query })

    await repository.getDiscoveryCandidates({ viewerProfileId: VIEWER_ID, limit: 10, searchQuery: 'a b c d e f g h i j' })

    const [sql, values] = query.mock.calls[0] as unknown as [string, readonly unknown[]]
    expect(sql).toContain('and p.search_text like ($2::text[])[8]')
    expect(sql).not.toContain('($2::text[])[9]')
    expect(sql).not.toContain('like all(')
    expect(values).toEqual([VIEWER_ID, ['%a%', '%b%', '%c%', '%d%', '%e%', '%f%', '%g%', '%h%'], 10])
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
    expect(sql).not.toContain('search_text')
    expect(sql).toContain('limit $2')
    expect(values).toEqual([VIEWER_ID, 18])
  })
})
