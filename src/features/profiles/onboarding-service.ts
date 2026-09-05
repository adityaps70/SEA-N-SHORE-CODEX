import { withTransaction as databaseTransaction } from '@/lib/db/client'
import {
  createOnboardingRepositoryForClient,
  type OnboardingRepository,
} from './onboarding-repository'
import type { OnboardingInput } from './schemas'

type OnboardingTransaction = <T>(fn: (repository: OnboardingRepository) => Promise<T>) => Promise<T>

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

  return { completeOnboarding }
}

const productionService = createOnboardingService({
  withTransaction: (fn) => databaseTransaction((client) => fn(createOnboardingRepositoryForClient(client))),
})

export const completeOnboardingWithAurora = productionService.completeOnboarding
