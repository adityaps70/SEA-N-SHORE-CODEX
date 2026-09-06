import { describe, expect, it, vi } from 'vitest'
import type { OnboardingInput } from './schemas'
import { createProfileEditService } from './profile-edit-service'

const actorId = '11111111-1111-4111-8111-111111111111'

function input(profileType: OnboardingInput['profileType'] = 'seafarer'): OnboardingInput {
  return {
    profileType,
    fullName: 'Captain Example',
    slug: 'captain-example',
    location: 'Mumbai',
    headline: 'Master Mariner and tanker specialist',
    summary: 'Experienced maritime professional focused on safe tanker operations.',
    contactVisibility: 'members',
    skills: ['Navigation', 'SIRE 2.0'],
    rank: profileType === 'seafarer' ? 'Master' : undefined,
    currentCompany: profileType === 'seafarer' ? 'Example Shipping' : undefined,
    currentVessel: profileType === 'seafarer' ? 'MV Example' : undefined,
    sailingExperienceYears: profileType === 'seafarer' ? 18 : undefined,
    vesselTypes: profileType === 'seafarer' ? ['Oil Tanker'] : [],
    tradingAreas: profileType === 'seafarer' ? ['Worldwide'] : [],
    shoreCareerPreference: false,
    availability: profileType === 'seafarer' ? 'Open to mentoring' : undefined,
  }
}

describe('completed profile edit service', () => {
  it('updates a completed maritime profile and skills in one transaction', async () => {
    const repository = {
      updateCompletedProfile: vi.fn(async () => true),
      upsertMaritimeProfile: vi.fn(async () => undefined),
      deleteMaritimeProfile: vi.fn(async () => undefined),
      replaceSkills: vi.fn(async () => undefined),
    }
    const withTransaction = vi.fn(async (fn: (repository: typeof repository) => Promise<unknown>) => fn(repository))
    const service = createProfileEditService({ withTransaction })
    const data = input()

    await expect(service.updateProfile(actorId, data)).resolves.toBe(true)

    expect(repository.updateCompletedProfile).toHaveBeenCalledWith(actorId, data)
    expect(repository.upsertMaritimeProfile).toHaveBeenCalledWith(actorId, data)
    expect(repository.deleteMaritimeProfile).not.toHaveBeenCalled()
    expect(repository.replaceSkills).toHaveBeenCalledWith(actorId, data.skills)
  })

  it('removes stale maritime details when the stored profile type is non-maritime', async () => {
    const repository = {
      updateCompletedProfile: vi.fn(async () => true),
      upsertMaritimeProfile: vi.fn(async () => undefined),
      deleteMaritimeProfile: vi.fn(async () => undefined),
      replaceSkills: vi.fn(async () => undefined),
    }
    const service = createProfileEditService({
      withTransaction: async (fn) => fn(repository),
    })
    const data = input('mentor')

    await service.updateProfile(actorId, data)

    expect(repository.deleteMaritimeProfile).toHaveBeenCalledWith(actorId)
    expect(repository.upsertMaritimeProfile).not.toHaveBeenCalled()
  })

  it('fails closed when the actor is not an active completed profile', async () => {
    const repository = {
      updateCompletedProfile: vi.fn(async () => false),
      upsertMaritimeProfile: vi.fn(async () => undefined),
      deleteMaritimeProfile: vi.fn(async () => undefined),
      replaceSkills: vi.fn(async () => undefined),
    }
    const service = createProfileEditService({
      withTransaction: async (fn) => fn(repository),
    })

    await expect(service.updateProfile(actorId, input())).rejects.toThrow('profile_edit_unavailable')
    expect(repository.upsertMaritimeProfile).not.toHaveBeenCalled()
    expect(repository.replaceSkills).not.toHaveBeenCalled()
  })
})
