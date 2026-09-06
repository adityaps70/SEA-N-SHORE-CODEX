import { withTransaction as databaseTransaction } from '@/lib/db/client'
import {
  createOnboardingRepositoryForClient,
  type OnboardingRepository,
} from './onboarding-repository'
import type { OnboardingInput } from './schemas'

export type ProfileEditRepository = Pick<
  OnboardingRepository,
  'updateCompletedProfile' | 'upsertMaritimeProfile' | 'deleteMaritimeProfile' | 'replaceSkills'
>

type ProfileEditTransaction = <T>(fn: (repository: ProfileEditRepository) => Promise<T>) => Promise<T>

function serviceError(code: string): never {
  throw new Error(code)
}

export function createProfileEditService(input: { withTransaction: ProfileEditTransaction }) {
  async function updateProfile(actorId: string, data: OnboardingInput) {
    return input.withTransaction(async (repository) => {
      if (!await repository.updateCompletedProfile(actorId, data)) {
        serviceError('profile_edit_unavailable')
      }

      if (data.profileType === 'seafarer' || data.profileType === 'maritime_professional') {
        await repository.upsertMaritimeProfile(actorId, data)
      } else {
        await repository.deleteMaritimeProfile(actorId)
      }

      await repository.replaceSkills(actorId, data.skills)
      return true
    })
  }

  return { updateProfile }
}

const productionService = createProfileEditService({
  withTransaction: (fn) => databaseTransaction((client) => fn(createOnboardingRepositoryForClient(client))),
})

export const updateProfileWithAurora = productionService.updateProfile
