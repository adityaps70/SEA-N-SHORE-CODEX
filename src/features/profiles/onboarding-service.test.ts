import { describe, expect, it, vi } from 'vitest'
import type { OnboardingInput } from './schemas'

const actorId = '11111111-1111-4111-8111-111111111111'

type Repository = {
  lockOnboardingProfile: (profileId: string) => Promise<boolean>
  updateProfile: (profileId: string, input: OnboardingInput) => Promise<void>
  upsertMaritimeProfile: (profileId: string, input: OnboardingInput) => Promise<void>
  deleteMaritimeProfile: (profileId: string) => Promise<void>
  replaceSkills: (profileId: string, skills: string[]) => Promise<void>
  finalizeOnboarding: (profileId: string) => Promise<boolean>
}

function seafarerInput(): OnboardingInput {
  return {
    profileType: 'seafarer',
    fullName: 'Captain Example',
    slug: 'captain-example',
    location: 'Mumbai',
    headline: 'Master Mariner and tanker specialist',
    summary: 'Experienced maritime professional focused on safe tanker operations.',
    contactVisibility: 'members',
    skills: ['Navigation', 'SIRE 2.0'],
    rank: 'Master',
    currentCompany: 'Example Shipping',
    currentVessel: 'MV Example',
    sailingExperienceYears: 18,
    vesselTypes: ['Oil Tanker'],
    tradingAreas: ['Worldwide'],
    shoreCareerPreference: false,
    availability: 'Open to mentoring',
  }
}

function makeRepository(overrides: Partial<Repository> = {}): Repository {
  return {
    lockOnboardingProfile: vi.fn(async () => true),
    updateProfile: vi.fn(async () => undefined),
    upsertMaritimeProfile: vi.fn(async () => undefined),
    deleteMaritimeProfile: vi.fn(async () => undefined),
    replaceSkills: vi.fn(async () => undefined),
    finalizeOnboarding: vi.fn(async () => true),
    ...overrides,
  }
}

async function serviceFor(repository: Repository) {
  const { createOnboardingService } = await import('./onboarding-service')
  const transactionSpy = vi.fn()
  const withTransaction = async <T>(fn: (repo: Repository) => Promise<T>) => {
    transactionSpy()
    return fn(repository)
  }
  return { service: createOnboardingService({ withTransaction }), transactionSpy }
}

describe('Aurora onboarding service authorization', () => {
  it('fails closed when the permanent profile is not active or onboarding is already complete', async () => {
    const repository = makeRepository({ lockOnboardingProfile: vi.fn(async () => false) })
    const { service } = await serviceFor(repository)

    await expect(service.completeOnboarding(actorId, seafarerInput())).rejects.toThrow('onboarding_unavailable')
    expect(repository.updateProfile).not.toHaveBeenCalled()
    expect(repository.finalizeOnboarding).not.toHaveBeenCalled()
  })

  it('uses only the authenticated permanent profile UUID for the complete maritime transaction', async () => {
    const repository = makeRepository()
    const { service, transactionSpy } = await serviceFor(repository)
    const input = seafarerInput()

    await expect(service.completeOnboarding(actorId, input)).resolves.toBe(true)

    expect(transactionSpy).toHaveBeenCalledTimes(1)
    expect(repository.lockOnboardingProfile).toHaveBeenCalledWith(actorId)
    expect(repository.updateProfile).toHaveBeenCalledWith(actorId, input)
    expect(repository.upsertMaritimeProfile).toHaveBeenCalledWith(actorId, input)
    expect(repository.deleteMaritimeProfile).not.toHaveBeenCalled()
    expect(repository.replaceSkills).toHaveBeenCalledWith(actorId, input.skills)
    expect(repository.finalizeOnboarding).toHaveBeenCalledWith(actorId)
  })

  it('removes stale maritime details for a non-maritime profile before finalizing', async () => {
    const repository = makeRepository()
    const { service } = await serviceFor(repository)
    const input: OnboardingInput = {
      ...seafarerInput(),
      profileType: 'mentor',
      rank: undefined,
      currentCompany: undefined,
      currentVessel: undefined,
      sailingExperienceYears: undefined,
      vesselTypes: [],
      tradingAreas: [],
      shoreCareerPreference: false,
      availability: undefined,
    }

    await service.completeOnboarding(actorId, input)

    expect(repository.deleteMaritimeProfile).toHaveBeenCalledWith(actorId)
    expect(repository.upsertMaritimeProfile).not.toHaveBeenCalled()
  })

  it('fails the transaction if finalization cannot update exactly the authenticated incomplete profile', async () => {
    const repository = makeRepository({ finalizeOnboarding: vi.fn(async () => false) })
    const { service } = await serviceFor(repository)

    await expect(service.completeOnboarding(actorId, seafarerInput())).rejects.toThrow('onboarding_unavailable')
  })
})
