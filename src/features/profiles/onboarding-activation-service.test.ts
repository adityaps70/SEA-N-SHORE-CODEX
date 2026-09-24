import { describe, expect, it, vi } from 'vitest'
import type { OnboardingActivationInput, OnboardingInput } from './schemas'
import type { ProfileType } from './types'

const actorId = '11111111-1111-4111-8111-111111111111'

type Repository = {
  lockOnboardingProfile: (profileId: string) => Promise<boolean>
  updateProfile: (profileId: string, input: OnboardingInput) => Promise<void>
  upsertMaritimeProfile: (profileId: string, input: OnboardingInput) => Promise<void>
  updateActivationProfile: (profileId: string, input: OnboardingActivationInput, profileType: ProfileType) => Promise<void>
  upsertActivationMaritimeProfile: (profileId: string, currentCompany?: string, rank?: string) => Promise<void>
  deleteMaritimeProfile: (profileId: string) => Promise<void>
  replaceSkills: (profileId: string, skills: string[]) => Promise<void>
  finalizeOnboarding: (profileId: string) => Promise<boolean>
}

function seafarerInput(): OnboardingActivationInput {
  return {
    persona: 'seafarer',
    profileIntents: ['find_jobs', 'network'],
    fullName: 'Asha Singh',
    slug: 'asha-singh',
    location: 'Mumbai',
    currentCompany: 'Oceanic Shipping',
    rank: 'Chief Engineer',
    headline: 'Chief Engineer',
    specialization: undefined,
    institutionName: undefined,
    familyRelationship: undefined,
    contactVisibility: 'members',
  }
}

function makeRepository(overrides: Partial<Repository> = {}): Repository {
  return {
    lockOnboardingProfile: vi.fn(async () => true),
    updateProfile: vi.fn(async () => undefined),
    upsertMaritimeProfile: vi.fn(async () => undefined),
    updateActivationProfile: vi.fn(async () => undefined),
    upsertActivationMaritimeProfile: vi.fn(async () => undefined),
    deleteMaritimeProfile: vi.fn(async () => undefined),
    replaceSkills: vi.fn(async () => undefined),
    finalizeOnboarding: vi.fn(async () => true),
    ...overrides,
  }
}

async function serviceFor(repository: Repository) {
  const { createOnboardingService } = await import('./onboarding-service')
  const withTransaction = async <T>(fn: (repo: Repository) => Promise<T>) => fn(repository)
  return createOnboardingService({ withTransaction })
}

describe('persona onboarding persistence', () => {
  it('persists a seafarer persona and projects the compatible legacy profile type', async () => {
    const repository = makeRepository()
    const service = await serviceFor(repository)
    const input = seafarerInput()

    await expect(service.completeActivation(actorId, input)).resolves.toBe(true)

    expect(repository.updateActivationProfile).toHaveBeenCalledWith(actorId, input, 'seafarer')
    expect(repository.upsertActivationMaritimeProfile).toHaveBeenCalledWith(
      actorId,
      'Oceanic Shipping',
      'Chief Engineer',
    )
    expect(repository.deleteMaritimeProfile).not.toHaveBeenCalled()
    expect(repository.finalizeOnboarding).toHaveBeenCalledWith(actorId)
  })

  it('maps recruiter persona to the legacy recruiter type without granting permission by profile type', async () => {
    const repository = makeRepository()
    const service = await serviceFor(repository)
    const input: OnboardingActivationInput = {
      ...seafarerInput(),
      persona: 'recruiter_hr',
      profileIntents: ['hire', 'network'],
      rank: undefined,
      headline: 'Crewing Manager',
    }

    await service.completeActivation(actorId, input)

    expect(repository.updateActivationProfile).toHaveBeenCalledWith(actorId, input, 'recruiter')
    expect(repository.upsertActivationMaritimeProfile).toHaveBeenCalledWith(
      actorId,
      'Oceanic Shipping',
      undefined,
    )
  })

  it('keeps seafarer family free from maritime-only persistence', async () => {
    const repository = makeRepository()
    const service = await serviceFor(repository)
    const input: OnboardingActivationInput = {
      ...seafarerInput(),
      persona: 'seafarer_family',
      profileIntents: ['community'],
      currentCompany: undefined,
      rank: undefined,
      familyRelationship: 'Spouse / partner',
      headline: 'Seafarer Family',
    }

    await service.completeActivation(actorId, input)

    expect(repository.updateActivationProfile).toHaveBeenCalledWith(actorId, input, 'maritime_professional')
    expect(repository.deleteMaritimeProfile).toHaveBeenCalledWith(actorId)
    expect(repository.upsertActivationMaritimeProfile).not.toHaveBeenCalled()
  })

  it('fails closed before writing when onboarding is unavailable', async () => {
    const repository = makeRepository({ lockOnboardingProfile: vi.fn(async () => false) })
    const service = await serviceFor(repository)

    await expect(service.completeActivation(actorId, seafarerInput())).rejects.toThrow('onboarding_unavailable')
    expect(repository.updateActivationProfile).not.toHaveBeenCalled()
  })
})
