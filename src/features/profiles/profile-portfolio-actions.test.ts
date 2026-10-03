import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getAwsOwnProfile: vi.fn(),
  createExperience: vi.fn(),
  updateExperience: vi.fn(),
  getProfilePortfolio: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./aws-queries', () => ({ getAwsOwnProfile: mocks.getAwsOwnProfile }))
vi.mock('./profile-portfolio-repository', () => ({
  createProfileExperienceRecord: mocks.createExperience,
  updateProfileExperienceRecord: mocks.updateExperience,
  deleteProfileExperienceRecord: vi.fn(),
  createProfileCredentialRecord: vi.fn(),
  updateProfileCredentialRecord: vi.fn(),
  deleteProfileCredentialRecord: vi.fn(),
  getProfilePortfolio: mocks.getProfilePortfolio,
}))

import { createProfileExperience, updateProfileExperience } from './profile-portfolio-actions'

const profileId = '11111111-1111-4111-8111-111111111111'
const experienceId = '33333333-3333-4333-8333-333333333333'

function experienceForm(values: Record<string, string>) {
  const form = new FormData()
  for (const [name, value] of Object.entries({ title: 'Deck Cadet', organization: 'Oceanic Shipping', ...values })) form.set(name, value)
  return form
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: profileId })
  mocks.getAwsOwnProfile.mockResolvedValue({ id: profileId, slug: 'aditya', profileType: 'maritime_professional', persona: 'maritime_enthusiast' })
  mocks.createExperience.mockResolvedValue({ id: experienceId })
  mocks.updateExperience.mockResolvedValue(true)
})

describe('experience actions follow the profile type (round 11)', () => {
  it('does not add sea service for a Maritime Enthusiast', async () => {
    const result = await createProfileExperience({}, experienceForm({ track: 'sea_service', vessel: 'MT Horizon' }))
    expect(result.fieldErrors?.track?.[0]).toMatch(/Sea service is for seafarer and cadet profiles/)
    expect(mocks.createExperience).not.toHaveBeenCalled()
  })

  it('saves a work role without any vessel details', async () => {
    await expect(createProfileExperience({}, experienceForm({
      track: 'other_maritime',
      title: 'Sales lead',
      organization: 'ig computers',
      vessel: 'MT Horizon',
      cargoExperience: 'Crude Oil',
    }))).resolves.toMatchObject({ success: true })
    expect(mocks.createExperience).toHaveBeenCalledWith(profileId, expect.objectContaining({
      track: 'other_maritime',
      vessel: null,
      vesselType: null,
      cargoExperience: [],
      engineExperience: [],
      tradingAreas: [],
    }))
  })

  it('still adds sea service for a Seafarer', async () => {
    mocks.getAwsOwnProfile.mockResolvedValueOnce({ id: profileId, slug: 'captain', profileType: 'seafarer', persona: 'seafarer' })
    await expect(createProfileExperience({}, experienceForm({ track: 'sea_service', vessel: 'MT Horizon' }))).resolves.toMatchObject({ success: true })
    expect(mocks.createExperience).toHaveBeenCalledWith(profileId, expect.objectContaining({ track: 'sea_service', vessel: 'MT Horizon' }))
  })

  it('keeps an existing sea-service record editable for any profile type', async () => {
    mocks.getProfilePortfolio.mockResolvedValueOnce({ experiences: [{ id: experienceId, track: 'sea_service' }], credentials: [] })
    await expect(updateProfileExperience(experienceId, {}, experienceForm({ track: 'sea_service', vessel: 'MT Horizon' }))).resolves.toMatchObject({ success: true })
    expect(mocks.updateExperience).toHaveBeenCalledWith(profileId, experienceId, expect.objectContaining({ track: 'sea_service', vessel: 'MT Horizon' }))
  })

  it('does not turn another record into sea service for a Maritime Enthusiast', async () => {
    mocks.getProfilePortfolio.mockResolvedValueOnce({ experiences: [{ id: experienceId, track: 'other_maritime' }], credentials: [] })
    const result = await updateProfileExperience(experienceId, {}, experienceForm({ track: 'sea_service' }))
    expect(result.fieldErrors?.track).toBeDefined()
    expect(mocks.updateExperience).not.toHaveBeenCalled()
  })
})
