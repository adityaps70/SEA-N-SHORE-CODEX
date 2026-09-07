import { describe, expect, it, vi } from 'vitest'
import type { OnboardingActivationInput, OnboardingInput } from './schemas'
import type { ProfileType } from './types'

const actorId = '11111111-1111-4111-8111-111111111111'

type Repository = {
  lockOnboardingProfile: (profileId: string) => Promise<boolean>
  updateProfile: (profileId: string, input: OnboardingInput) => Promise<void>
  upsertMaritimeProfile: (profileId: string, input: OnboardingInput) => Promise<void>
  updateActivationProfile: (profileId: string, input: OnboardingActivationInput, profileType: ProfileType) => Promise<void>
  upsertActivationMaritimeProfile: (profileId: string, currentCompany?: string) => Promise<void>
  deleteMaritimeProfile: (profileId: string) => Promise<void>
  replaceSkills: (profileId: string, skills: string[]) => Promise<void>
  finalizeOnboarding: (profileId: string) => Promise<boolean>
}

function professionalInput(): OnboardingActivationInput {
  return {
    identityRoot: 'professional',
    primaryIdentity: 'Chief Engineer',
    primaryIdentityFamily: 'Sea-going · Engine',
    secondaryIdentities: ['Mentor', 'ISM Auditor'],
    fullName: 'Asha Singh',
    slug: 'asha-singh',
    location: 'Mumbai',
    currentCompany: 'Oceanic Shipping',
    headline: 'Chief Engineer',
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

describe('exact identity onboarding persistence', () => {
  it('persists a professional exact identity and only projects the legacy broad type', async () => {
    const repository = makeRepository()
    const service = await serviceFor(repository)
    const input = professionalInput()

    await expect(service.completeActivation(actorId, input)).resolves.toBe(true)

    expect(repository.updateActivationProfile).toHaveBeenCalledWith(actorId, input, 'seafarer')
    expect(repository.upsertActivationMaritimeProfile).toHaveBeenCalledWith(actorId, 'Oceanic Shipping')
    expect(repository.deleteMaritimeProfile).not.toHaveBeenCalled()
    expect(repository.replaceSkills).not.toHaveBeenCalled()
    expect(repository.finalizeOnboarding).toHaveBeenCalledWith(actorId)
  })

  it('maps an organisation to the legacy company type and clears maritime-only state', async () => {
    const repository = makeRepository()
    const service = await serviceFor(repository)
    const input: OnboardingActivationInput = {
      identityRoot: 'organisation',
      primaryIdentity: 'Shipowner',
      primaryIdentityFamily: 'Shipping & Ship Management',
      secondaryIdentities: ['Technical Ship Manager'],
      fullName: 'Oceanic Marine Pvt Ltd',
      slug: 'oceanic-marine',
      location: 'Mumbai',
      currentCompany: undefined,
      headline: 'Shipowner',
      contactVisibility: 'members',
    }

    await service.completeActivation(actorId, input)

    expect(repository.updateActivationProfile).toHaveBeenCalledWith(actorId, input, 'company')
    expect(repository.deleteMaritimeProfile).toHaveBeenCalledWith(actorId)
    expect(repository.upsertActivationMaritimeProfile).not.toHaveBeenCalled()
  })

  it('fails closed before writing when onboarding is unavailable', async () => {
    const repository = makeRepository({ lockOnboardingProfile: vi.fn(async () => false) })
    const service = await serviceFor(repository)

    await expect(service.completeActivation(actorId, professionalInput())).rejects.toThrow('onboarding_unavailable')
    expect(repository.updateActivationProfile).not.toHaveBeenCalled()
  })
})
