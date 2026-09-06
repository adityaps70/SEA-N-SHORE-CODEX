import { describe, expect, it, vi } from 'vitest'
import type { OnboardingInput } from './schemas'
import {
  createProfileEditService,
  type ProfileEditRepository,
} from './profile-edit-service'

const actorId = '11111111-1111-4111-8111-111111111111'

function repositoryDouble(updateResult = true): ProfileEditRepository {
  const updateCompletedProfile: ProfileEditRepository['updateCompletedProfile'] = vi.fn(async () => updateResult)
  const upsertMaritimeProfile: ProfileEditRepository['upsertMaritimeProfile'] = vi.fn(async () => undefined)
  const deleteMaritimeProfile: ProfileEditRepository['deleteMaritimeProfile'] = vi.fn(async () => undefined)
  const replaceSkills: ProfileEditRepository['replaceSkills'] = vi.fn(async () => undefined)
  return { updateCompletedProfile, upsertMaritimeProfile, deleteMaritimeProfile, replaceSkills }
}

function withRepository(repository: ProfileEditRepository) {
  return async <T>(fn: (repository: ProfileEditRepository) => Promise<T>): Promise<T> => fn(repository)
}

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
    const repository = repositoryDouble()
    const service = createProfileEditService({ withTransaction: withRepository(repository) })
    const data = input()

    await expect(service.updateProfile(actorId, data)).resolves.toBe(true)

    expect(vi.mocked(repository.updateCompletedProfile)).toHaveBeenCalledWith(actorId, data)
    expect(vi.mocked(repository.upsertMaritimeProfile)).toHaveBeenCalledWith(actorId, data)
    expect(vi.mocked(repository.deleteMaritimeProfile)).not.toHaveBeenCalled()
    expect(vi.mocked(repository.replaceSkills)).toHaveBeenCalledWith(actorId, data.skills)
  })

  it('removes stale maritime details when the stored profile type is non-maritime', async () => {
    const repository = repositoryDouble()
    const service = createProfileEditService({ withTransaction: withRepository(repository) })
    const data = input('mentor')

    await service.updateProfile(actorId, data)

    expect(vi.mocked(repository.deleteMaritimeProfile)).toHaveBeenCalledWith(actorId)
    expect(vi.mocked(repository.upsertMaritimeProfile)).not.toHaveBeenCalled()
  })

  it('fails closed when the actor is not an active completed profile', async () => {
    const repository = repositoryDouble(false)
    const service = createProfileEditService({ withTransaction: withRepository(repository) })

    await expect(service.updateProfile(actorId, input())).rejects.toThrow('profile_edit_unavailable')
    expect(vi.mocked(repository.upsertMaritimeProfile)).not.toHaveBeenCalled()
    expect(vi.mocked(repository.replaceSkills)).not.toHaveBeenCalled()
  })
})
