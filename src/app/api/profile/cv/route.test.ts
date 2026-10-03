import { beforeEach, describe, expect, it, vi } from 'vitest'

const profile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'captain-example',
  profileType: 'seafarer',
  identityRoot: 'professional',
  primaryIdentity: 'Master Mariner',
  primaryIdentityFamily: 'Sea-going professional',
  secondaryIdentities: ['Tanker professional'],
  fullName: 'Captain Example',
  avatarPath: null,
  avatarUrl: null,
  coverPath: null,
  coverUrl: null,
  location: 'Mumbai, India',
  headline: 'Master Mariner | Oil & Chemical Tankers',
  summary: 'Master Mariner with international tanker command experience and a strong safety leadership record.',
  rank: 'Master',
  currentCompany: 'Example Shipping',
  currentVessel: 'MT Example',
  sailingExperienceYears: 18,
  vesselTypes: ['Oil Tanker', 'Chemical Tanker'],
  tradingAreas: ['Worldwide'],
  shoreCareerPreference: true,
  availability: 'ASHORE',
  skills: ['SIRE 2.0', 'Leadership'],
  contactVisibility: 'members',
  onboardingCompletedAt: '2026-09-01T00:00:00.000Z',
}

const portfolio = {
  experiences: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      profileId: profile.id,
      track: 'sea_service',
      title: 'Master',
      organization: 'Example Shipping',
      vessel: 'MT Example',
      vesselType: 'Oil Tanker',
      location: null,
      startedOn: '2024-01-01',
      endedOn: null,
      isCurrent: true,
      description: 'Command responsibility for international tanker operations.',
      cargoExperience: ['Crude Oil', 'CPP'],
      engineExperience: [],
      tradingAreas: ['Worldwide'],
      sortOrder: 0,
    },
  ],
  credentials: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      profileId: profile.id,
      name: 'Certificate of Competency - Master',
      issuer: 'DG Shipping India',
      credentialNumber: 'COC-12345',
      issuedOn: '2023-04-12',
      expiresOn: '2028-04-11',
      noExpiry: false,
      verificationState: 'self_reported',
      sortOrder: 0,
    },
  ],
}

vi.mock('@/features/profiles/queries', () => ({
  getOwnProfile: vi.fn(async () => profile),
}))

vi.mock('@/features/profiles/profile-portfolio-queries', () => ({
  getOwnProfilePortfolio: vi.fn(async () => portfolio),
}))

describe('GET /api/profile/cv', () => {
  beforeEach(() => vi.resetModules())

  it('returns a downloadable PDF generated from the current Maritime Passport data', async () => {
    const { GET } = await import('./route')
    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/pdf')
    expect(response.headers.get('content-disposition')).toContain('attachment')
    expect(response.headers.get('content-disposition')).toContain('captain-example-maritime-cv.pdf')
    expect(response.headers.get('cache-control')).toBe('private, no-store')

    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(bytes.byteLength).toBeGreaterThan(500)
  })
})
