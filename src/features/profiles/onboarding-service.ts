import { withTransaction as databaseTransaction } from '@/lib/db/client'
import { legacyProfileTypeForPersona, personaUsesProfessionalCompany } from './persona'
import {
  createOnboardingRepositoryForClient,
  type OnboardingRepository,
} from './onboarding-repository'
import type { OnboardingActivationInput, OnboardingInput } from './schemas'

type OnboardingServiceRepository = Pick<
  OnboardingRepository,
  | 'lockOnboardingProfile'
  | 'updateProfile'
  | 'updateActivationProfile'
  | 'upsertMaritimeProfile'
  | 'upsertActivationMaritimeProfile'
  | 'deleteMaritimeProfile'
  | 'replaceSkills'
  | 'finalizeOnboarding'
>

type OnboardingTransaction = <T>(fn: (repository: OnboardingServiceRepository) => Promise<T>) => Promise<T>

function serviceError(code: string): never {
  throw new Error(code)
}

export function createOnboardingService(input: { withTransaction: OnboardingTransaction }) {
  async function completeOnboarding(actorId: string, data: OnboardingInput) {
    return input.withTransaction(async (repository) => {
      if (!await repository.lockOnboardingProfile(actorId)) {
        serviceError('onboarding_unavailable')
      }

      await repository.updateProfile(actorId, data)

      if (data.profileType === 'seafarer' || data.profileType === 'maritime_professional') {
        await repository.upsertMaritimeProfile(actorId, data)
      } else {
        await repository.deleteMaritimeProfile(actorId)
      }

      await repository.replaceSkills(actorId, data.skills)

      if (!await repository.finalizeOnboarding(actorId)) {
        serviceError('onboarding_unavailable')
      }

      return true
    })
  }

  async function completeActivation(actorId: string, data: OnboardingActivationInput) {
    return input.withTransaction(async (repository) => {
      if (!await repository.lockOnboardingProfile(actorId)) {
        serviceError('onboarding_unavailable')
      }

      const profileType = legacyProfileTypeForPersona(data.persona)
      await repository.updateActivationProfile(actorId, data, profileType)

      if (personaUsesProfessionalCompany(data.persona)) {
        await repository.upsertActivationMaritimeProfile(actorId, data.currentCompany, data.rank)
      } else {
        await repository.deleteMaritimeProfile(actorId)
      }

      if (!await repository.finalizeOnboarding(actorId)) {
        serviceError('onboarding_unavailable')
      }

      return true
    })
  }

  return { completeOnboarding, completeActivation }
}

const productionService = createOnboardingService({
  withTransaction: (fn) => databaseTransaction((client) => fn(createOnboardingRepositoryForClient(client))),
})

export const completeOnboardingWithAurora = productionService.completeOnboarding
export const completeActivationWithAurora = productionService.completeActivation
