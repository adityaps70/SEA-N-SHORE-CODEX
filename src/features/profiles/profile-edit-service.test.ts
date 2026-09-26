import { describe, expect, it, vi } from 'vitest'
import type { OnboardingInput } from './schemas'
import {
  createProfileEditService,
  type ProfileEditRepository,
} from './profile-edit-service'

const actorId = '11111111-1111-4111-8111-111111111111'

type EditState = { slug: string; usernameChangeCount: number }

function repositoryDouble(
  updateResult = true,
  editState: EditState | null = { slug: 'captain-example', usernameChangeCount: 0 },
): ProfileEditRepository {
  const lockCompletedProfile: ProfileEditRepository['lockCompletedProfile'] = vi.fn(async () => editState)
  const updateCompletedProfile: ProfileEditRepository['updateCompletedProfile'] = vi.fn(async () => updateResult)
  const upsertMaritimeProfile: ProfileEditRepository['upsertMaritimeProfile'] = vi.fn(async () => undefined)
  const upsertActivationMaritimeProfile: ProfileEditRepository['upsertActivationMaritimeProfile'] = vi.fn(async () => undefined)
  const deleteMaritimeProfile: ProfileEditRepository['deleteMaritimeProfile'] = vi.fn(async () => undefined)
  const replaceSkills: ProfileEditRepository['replaceSkills'] = vi.fn(async () => undefined)
  return { lockCompletedProfile, updateCompletedProfile, upsertMaritimeProfile, upsertActivationMaritimeProfile, deleteMaritimeProfile, replaceSkills }
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

    expect(vi.mocked(repository.lockCompletedProfile)).toHaveBeenCalledWith(actorId)
    expect(vi.mocked(repository.updateCompletedProfile)).toHaveBeenCalledWith(actorId, data)
    expect(vi.mocked(repository.upsertMaritimeProfile)).toHaveBeenCalledWith(actorId, data)
    expect(vi.mocked(repository.deleteMaritimeProfile)).not.toHaveBeenCalled()
    expect(vi.mocked(repository.replaceSkills)).toHaveBeenCalledWith(actorId, data.skills)
  })

  it('allows the second post-onboarding username change', async () => {
    const repository = repositoryDouble(true, { slug: 'captain-old', usernameChangeCount: 1 })
    const service = createProfileEditService({ withTransaction: withRepository(repository) })
    const data = { ...input(), slug: 'captain-new' }

    await expect(service.updateProfile(actorId, data)).resolves.toBe(true)
    expect(vi.mocked(repository.updateCompletedProfile)).toHaveBeenCalledWith(actorId, data)
  })

  it('rejects a third post-onboarding username change before writing profile data', async () => {
    const repository = repositoryDouble(true, { slug: 'captain-old', usernameChangeCount: 2 })
    const service = createProfileEditService({ withTransaction: withRepository(repository) })
    const data = { ...input(), slug: 'captain-third' }

    await expect(service.updateProfile(actorId, data)).rejects.toThrow('username_change_limit')
    expect(vi.mocked(repository.updateCompletedProfile)).not.toHaveBeenCalled()
    expect(vi.mocked(repository.upsertMaritimeProfile)).not.toHaveBeenCalled()
    expect(vi.mocked(repository.replaceSkills)).not.toHaveBeenCalled()
  })

  it('does not consume the username allowance when the username is unchanged', async () => {
    const repository = repositoryDouble(true, { slug: 'captain-example', usernameChangeCount: 2 })
    const service = createProfileEditService({ withTransaction: withRepository(repository) })

    await expect(service.updateProfile(actorId, input())).resolves.toBe(true)
    expect(vi.mocked(repository.updateCompletedProfile)).toHaveBeenCalled()
  })

  it('preserves current company for a professional identity whose legacy profile type is non-maritime', async () => {
    const repository = repositoryDouble()
    const service = createProfileEditService({ withTransaction: withRepository(repository) })
    const data = { ...input('mentor'), currentCompany: 'New Shipping Co' }

    await service.updateProfile(actorId, data, true)

    expect(vi.mocked(repository.upsertActivationMaritimeProfile)).toHaveBeenCalledWith(actorId, 'New Shipping Co')
    expect(vi.mocked(repository.deleteMaritimeProfile)).not.toHaveBeenCalled()
    expect(vi.mocked(repository.upsertMaritimeProfile)).not.toHaveBeenCalled()
  })

  it('preserves legacy maritime details when a non-seafarer profile is edited', async () => {
    const repository = repositoryDouble()
    const service = createProfileEditService({ withTransaction: withRepository(repository) })
    const data = input('mentor')

    await service.updateProfile(actorId, data)

    expect(vi.mocked(repository.deleteMaritimeProfile)).not.toHaveBeenCalled()
    expect(vi.mocked(repository.upsertMaritimeProfile)).not.toHaveBeenCalled()
  })

  it('fails closed when the actor is not an active completed profile', async () => {
    const repository = repositoryDouble(true, null)
    const service = createProfileEditService({ withTransaction: withRepository(repository) })

    await expect(service.updateProfile(actorId, input())).rejects.toThrow('profile_edit_unavailable')
    expect(vi.mocked(repository.updateCompletedProfile)).not.toHaveBeenCalled()
    expect(vi.mocked(repository.upsertMaritimeProfile)).not.toHaveBeenCalled()
    expect(vi.mocked(repository.replaceSkills)).not.toHaveBeenCalled()
  })
})
