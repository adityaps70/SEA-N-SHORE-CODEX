import { withTransaction as databaseTransaction } from '@/lib/db/client'
import {
  createOnboardingRepositoryForClient,
  type OnboardingRepository,
} from './onboarding-repository'
import type { OnboardingInput } from './schemas'

export type ProfileEditRepository = Pick<
  OnboardingRepository,
  | 'lockCompletedProfile'
  | 'updateCompletedProfile'
  | 'upsertMaritimeProfile'
  | 'upsertActivationMaritimeProfile'
  | 'deleteMaritimeProfile'
  | 'replaceSkills'
>

type ProfileEditTransaction = <T>(fn: (repository: ProfileEditRepository) => Promise<T>) => Promise<T>

function serviceError(code: string): never {
  throw new Error(code)
}

export function createProfileEditService(input: { withTransaction: ProfileEditTransaction }) {
  async function updateProfile(
    actorId: string,
    data: OnboardingInput,
    supportsCurrentCompany = data.profileType === 'seafarer' || data.profileType === 'maritime_professional',
  ) {
    return input.withTransaction(async (repository) => {
      const current = await repository.lockCompletedProfile(actorId)
      if (!current) serviceError('profile_edit_unavailable')

      const usernameChanged = current.slug !== data.slug
      if (usernameChanged && current.usernameChangeCount >= 2) {
        serviceError('username_change_limit')
      }

      if (!await repository.updateCompletedProfile(actorId, data)) {
        serviceError('profile_edit_unavailable')
      }

      if (data.profileType === 'seafarer' || data.profileType === 'maritime_professional') {
        await repository.upsertMaritimeProfile(actorId, data)
      } else if (supportsCurrentCompany) {
        await repository.upsertActivationMaritimeProfile(actorId, data.currentCompany)
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
