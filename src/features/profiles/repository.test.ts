import { describe, expect, it, vi } from 'vitest'

type ProfileQueryRow = {
  id: string
  slug: string | null
  profile_type: string | null
  full_name: string
  avatar_path: string | null
  location: string | null
  headline: string | null
  summary: string | null
  contact_visibility?: string | null
  onboarding_completed_at?: string | null
  maritime_profiles: {
    rank: string | null
    current_company: string | null
    current_vessel: string | null
    sailing_experience_years: number | null
    vessel_types: string[]
    trading_areas: string[]
    shore_career_preference: boolean
    availability: string | null
  } | null
  profile_skills: Array<{ skill: string }>
}

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const PROFILE_A_ID = '22222222-2222-4222-8222-222222222222'
const PROFILE_B_ID = '33333333-3333-4333-8333-333333333333'

function profileRow(overrides: Partial<ProfileQueryRow> = {}): ProfileQueryRow {
  return {
    id: PROFILE_A_ID,
    slug: 'captain-ananya-rao',
    profile_type: 'seafarer',
    full_name: 'Captain Ananya Rao',
    avatar_path: 'profiles/ananya.jpg',
    location: 'Mumbai, India',
    headline: 'Master Mariner',
    summary: 'Tanker professional and maritime mentor.',
    maritime_profiles: {
      rank: 'Master',
      current_company: 'Oceanic Shipping',
      current_vessel: 'MV Horizon',
      sailing_experience_years: 14.5,
      vessel_types: ['Oil Tanker', 'Chemical Tanker'],
      trading_areas: ['Middle East', 'Asia'],
      shore_career_preference: true,
      availability: 'Open to opportunities',
    },
    profile_skills: [{ skill: 'SIRE 2.0' }, { skill: 'Tanker Operations' }],
    ...overrides,
  }
}

describe('Aurora profile repository', () => {
  it('hydrates the signed-in member own profile with maritime details, skills and own-only fields', async () => {
    const query = vi.fn(async () => [
      profileRow({
        id: VIEWER_ID,
        slug: 'captain-viewer',
        full_name: 'Captain Viewer',
        contact_visibility: 'members',
        onboarding_completed_at: '2026-09-01T10:00:00.000Z',
      }),
    ])
    const { createProfileRepository } = await import('./repository')
    const repository = createProfileRepository({ query })

    await expect(repository.getOwnProfile(VIEWER_ID)).resolves.toMatchObject({
      id: VIEWER_ID,
      slug: 'captain-viewer',
      fullName: 'Captain Viewer',
      rank: 'Master',
      vesselTypes: ['Oil Tanker', 'Chemical Tanker'],
      skills: ['SIRE 2.0', 'Tanker Operations'],
      contactVisibility: 'members',
      onboardingCompletedAt: '2026-09-01T10:00:00.000Z',
    })

    expect(query).toHaveBeenCalledWith(expect.stringContaining('where p.id = $1'), [VIEWER_ID])
  })

  it('returns null for an own profile that has not completed onboarding', async () => {
    const query = vi.fn(async () => [
      profileRow({
        id: VIEWER_ID,
        contact_visibility: 'private',
        onboarding_completed_at: null,
      }),
    ])
    const { createProfileRepository } = await import('./repository')
    const repository = createProfileRepository({ query })

    await expect(repository.getOwnProfile(VIEWER_ID)).resolves.toBeNull()
  })

  it('loads an active completed public profile by slug and excludes a blocked pair for an authenticated viewer', async () => {
    const query = vi.fn(async () => [profileRow()])
    const { createProfileRepository } = await import('./repository')
    const repository = createProfileRepository({ query })

    await expect(
      repository.getPublicProfileBySlug({
        slug: 'captain-ananya-rao',
        viewerProfileId: VIEWER_ID,
      }),
    ).resolves.toMatchObject({
      id: PROFILE_A_ID,
      fullName: 'Captain Ananya Rao',
      rank: 'Master',
    })

    const sql = String(query.mock.calls[0]?.[0])
    expect(sql).toContain("p.account_status = 'active'")
    expect(sql).toContain('p.onboarding_completed_at is not null')
    expect(sql).toContain('from public.user_blocks')
    expect(sql).toContain('b.blocker_id = $2 and b.blocked_id = p.id')
    expect(sql).toContain('b.blocker_id = p.id and b.blocked_id = $2')
    expect(query).toHaveBeenCalledWith(expect.any(String), ['captain-ananya-rao', VIEWER_ID])
  })

  it('does not add block filtering to an anonymous public slug lookup', async () => {
    const query = vi.fn(async () => [profileRow()])
    const { createProfileRepository } = await import('./repository')
    const repository = createProfileRepository({ query })

    await repository.getPublicProfileBySlug({ slug: 'captain-ananya-rao' })

    const sql = String(query.mock.calls[0]?.[0])
    expect(sql).not.toContain('from public.user_blocks')
    expect(query).toHaveBeenCalledWith(expect.any(String), ['captain-ananya-rao'])
  })

  it('hydrates public profile IDs in caller order, preserves duplicates, and omits unavailable IDs', async () => {
    const query = vi.fn(async () => [
      profileRow({ id: PROFILE_B_ID, slug: 'chief-engineer-b', full_name: 'Chief Engineer B' }),
      profileRow({ id: PROFILE_A_ID, slug: 'captain-a', full_name: 'Captain A' }),
    ])
    const { createProfileRepository } = await import('./repository')
    const repository = createProfileRepository({ query })
    const missingId = '44444444-4444-4444-8444-444444444444'

    const profiles = await repository.getPublicProfilesByIds({
      ids: [PROFILE_A_ID, missingId, PROFILE_B_ID, PROFILE_A_ID],
      viewerProfileId: VIEWER_ID,
    })

    expect(profiles.map((profile) => profile.id)).toEqual([
      PROFILE_A_ID,
      PROFILE_B_ID,
      PROFILE_A_ID,
    ])
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('p.id = any($1::uuid[])'),
      [[PROFILE_A_ID, missingId, PROFILE_B_ID], VIEWER_ID],
    )
    expect(String(query.mock.calls[0]?.[0])).toContain('from public.user_blocks')
  })

  it('returns an empty list without querying Aurora when no profile IDs need hydration', async () => {
    const query = vi.fn(async (): Promise<ProfileQueryRow[]> => [])
    const { createProfileRepository } = await import('./repository')
    const repository = createProfileRepository({ query })

    await expect(
      repository.getPublicProfilesByIds({ ids: [], viewerProfileId: VIEWER_ID }),
    ).resolves.toEqual([])
    expect(query).not.toHaveBeenCalled()
  })

  it('loads deterministic discovery candidates while excluding self and both directions of blocking', async () => {
    const query = vi.fn(async () => [profileRow()])
    const { createProfileRepository } = await import('./repository')
    const repository = createProfileRepository({ query })

    await repository.getDiscoveryCandidates({ viewerProfileId: VIEWER_ID, limit: 18 })

    const sql = String(query.mock.calls[0]?.[0])
    expect(sql).toContain('p.id <> $1')
    expect(sql).toContain("p.account_status = 'active'")
    expect(sql).toContain('p.onboarding_completed_at is not null')
    expect(sql).toContain('from public.user_blocks')
    expect(sql).toContain('b.blocker_id = $1 and b.blocked_id = p.id')
    expect(sql).toContain('b.blocker_id = p.id and b.blocked_id = $1')
    expect(sql).toContain('order by p.updated_at desc, p.id asc')
    expect(query).toHaveBeenCalledWith(expect.any(String), [VIEWER_ID, 18])
  })

  it('clamps discovery limits to the current 1 through 60 profile window', async () => {
    const query = vi.fn(async (): Promise<ProfileQueryRow[]> => [])
    const { createProfileRepository } = await import('./repository')
    const repository = createProfileRepository({ query })

    await repository.getDiscoveryCandidates({ viewerProfileId: VIEWER_ID, limit: 0 })
    await repository.getDiscoveryCandidates({ viewerProfileId: VIEWER_ID, limit: 500 })

    expect(query.mock.calls[0]?.[1]).toEqual([VIEWER_ID, 1])
    expect(query.mock.calls[1]?.[1]).toEqual([VIEWER_ID, 60])
  })

  it('fails closed when a public row is missing a valid slug or profile type', async () => {
    const query = vi.fn(async () => [profileRow({ slug: null, profile_type: null })])
    const { createProfileRepository } = await import('./repository')
    const repository = createProfileRepository({ query })

    await expect(
      repository.getPublicProfileBySlug({ slug: 'invalid-profile', viewerProfileId: VIEWER_ID }),
    ).resolves.toBeNull()
  })
})
