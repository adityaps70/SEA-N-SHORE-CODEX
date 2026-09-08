import { describe, expect, it, vi } from 'vitest'

const PROFILE_ID = '11111111-1111-4111-8111-111111111111'
const EXPERIENCE_ID = '44444444-4444-4444-8444-444444444444'

type QueryCall = [text: string, values?: readonly unknown[]]

function callsOf(query: { mock: { calls: unknown[] } }): QueryCall[] {
  return query.mock.calls as unknown as QueryCall[]
}

const seaExperienceInput = {
  track: 'sea_service' as const,
  title: 'Master',
  organization: 'Oceanic Shipping',
  vessel: 'MT Horizon',
  vesselType: 'Oil Tanker',
  location: null,
  startedOn: '2024-01-01',
  endedOn: null,
  isCurrent: true,
  description: 'Command responsibility on worldwide tanker trades.',
  cargoExperience: ['Crude Oil'],
  engineExperience: [],
  tradingAreas: ['Worldwide'],
}

describe('profile portfolio repository', () => {
  it('hydrates ordered career experience and credential wallet records', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([
        {
          id: '22222222-2222-4222-8222-222222222222',
          profile_id: PROFILE_ID,
          track: 'sea_service',
          title: 'Master',
          organization: 'Oceanic Shipping',
          vessel: 'MT Horizon',
          vessel_type: 'Oil Tanker',
          location: null,
          started_on: '2024-01-01',
          ended_on: null,
          is_current: true,
          description: 'Command responsibility on worldwide tanker trades.',
          cargo_experience: ['Crude Oil', 'Clean Petroleum Products'],
          engine_experience: [],
          trading_areas: ['Worldwide'],
          sort_order: 10,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: '33333333-3333-4333-8333-333333333333',
          profile_id: PROFILE_ID,
          name: 'Certificate of Competency - Master',
          issuer: 'DG Shipping India',
          credential_number: 'COC-12345',
          issued_on: '2023-04-12',
          expires_on: '2028-04-11',
          no_expiry: false,
          verification_state: 'self_reported',
          sort_order: 10,
        },
      ])

    const { createProfilePortfolioRepository } = await import('./profile-portfolio-repository')
    const repository = createProfilePortfolioRepository({ query })

    await expect(repository.getProfilePortfolio(PROFILE_ID)).resolves.toEqual({
      experiences: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          profileId: PROFILE_ID,
          track: 'sea_service',
          title: 'Master',
          organization: 'Oceanic Shipping',
          vessel: 'MT Horizon',
          vesselType: 'Oil Tanker',
          location: null,
          startedOn: '2024-01-01',
          endedOn: null,
          isCurrent: true,
          description: 'Command responsibility on worldwide tanker trades.',
          cargoExperience: ['Crude Oil', 'Clean Petroleum Products'],
          engineExperience: [],
          tradingAreas: ['Worldwide'],
          sortOrder: 10,
        },
      ],
      credentials: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          profileId: PROFILE_ID,
          name: 'Certificate of Competency - Master',
          issuer: 'DG Shipping India',
          credentialNumber: 'COC-12345',
          issuedOn: '2023-04-12',
          expiresOn: '2028-04-11',
          noExpiry: false,
          verificationState: 'self_reported',
          sortOrder: 10,
        },
      ],
    })

    expect(String(callsOf(query)[0]?.[0])).toContain('from public.profile_experiences')
    expect(String(callsOf(query)[0]?.[0])).toContain('order by is_current desc')
    expect(String(callsOf(query)[1]?.[0])).toContain('from public.profile_credentials')
    expect(query).toHaveBeenNthCalledWith(1, expect.any(String), [PROFILE_ID])
    expect(query).toHaveBeenNthCalledWith(2, expect.any(String), [PROFILE_ID])
  })

  it('fails credential verification state closed to self-reported when storage contains an unknown value', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: '33333333-3333-4333-8333-333333333333',
          profile_id: PROFILE_ID,
          name: 'Advanced Tanker Training',
          issuer: 'Training Centre',
          credential_number: null,
          issued_on: null,
          expires_on: null,
          no_expiry: true,
          verification_state: 'mystery_verified',
          sort_order: 0,
        },
      ])

    const { createProfilePortfolioRepository } = await import('./profile-portfolio-repository')
    const portfolio = await createProfilePortfolioRepository({ query }).getProfilePortfolio(PROFILE_ID)

    expect(portfolio.credentials[0]?.verificationState).toBe('self_reported')
  })

  it('returns empty portfolio arrays without manufacturing experience or credentials', async () => {
    const query = vi.fn().mockResolvedValue([])
    const { createProfilePortfolioRepository } = await import('./profile-portfolio-repository')

    await expect(createProfilePortfolioRepository({ query }).getProfilePortfolio(PROFILE_ID)).resolves.toEqual({
      experiences: [],
      credentials: [],
    })
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('creates a career record under the authenticated profile id', async () => {
    const query = vi.fn().mockResolvedValue([{ id: EXPERIENCE_ID }])
    const { createProfilePortfolioRepository } = await import('./profile-portfolio-repository')

    await expect(createProfilePortfolioRepository({ query }).createProfileExperience(PROFILE_ID, seaExperienceInput)).resolves.toBe(EXPERIENCE_ID)

    const [sql, values] = callsOf(query)[0] ?? []
    expect(String(sql)).toContain('insert into public.profile_experiences')
    expect(values?.[0]).toBe(PROFILE_ID)
    expect(values).toContain('MT Horizon')
  })

  it('updates a career record only when both record id and owner profile id match', async () => {
    const query = vi.fn().mockResolvedValue([{ id: EXPERIENCE_ID }])
    const { createProfilePortfolioRepository } = await import('./profile-portfolio-repository')

    await expect(createProfilePortfolioRepository({ query }).updateProfileExperience(PROFILE_ID, EXPERIENCE_ID, seaExperienceInput)).resolves.toBe(true)

    const [sql, values] = callsOf(query)[0] ?? []
    expect(String(sql)).toContain('where id = $1')
    expect(String(sql)).toContain('and profile_id = $2')
    expect(values?.slice(0, 2)).toEqual([EXPERIENCE_ID, PROFILE_ID])
  })

  it('deletes a career record only when both record id and owner profile id match', async () => {
    const query = vi.fn().mockResolvedValue([{ id: EXPERIENCE_ID }])
    const { createProfilePortfolioRepository } = await import('./profile-portfolio-repository')

    await expect(createProfilePortfolioRepository({ query }).deleteProfileExperience(PROFILE_ID, EXPERIENCE_ID)).resolves.toBe(true)

    const [sql, values] = callsOf(query)[0] ?? []
    expect(String(sql)).toContain('delete from public.profile_experiences')
    expect(String(sql)).toContain('where id = $1')
    expect(String(sql)).toContain('and profile_id = $2')
    expect(values).toEqual([EXPERIENCE_ID, PROFILE_ID])
  })
})
