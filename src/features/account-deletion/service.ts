import { CognitoApiError, type CognitoSignInResult } from '@/lib/auth/cognito-api'
import { deleteMediaObject as runtimeDeleteMediaObject } from '@/lib/aws/storage'
import { accountDeletionRepository } from './repository'

type CognitoDeletionApi = {
  signIn(input: { username: string; password: string }): Promise<CognitoSignInResult>
  deleteUser(accessToken: string): Promise<void>
}

type AccountDeletionRepository = Pick<
  typeof accountDeletionRepository,
  'deleteAccountWithIdentity' | 'finalizeAccountDeletion'
>

type DeleteMediaObject = (key: string) => Promise<void>

export class AccountDeletionError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'AccountDeletionError'
    this.code = code
  }
}

function isFirstPartyStoragePath(value: string) {
  if (!value.trim()) return false
  try {
    const url = new URL(value)
    return url.protocol !== 'http:' && url.protocol !== 'https:'
  } catch {
    return !value.startsWith('/')
  }
}

export function createAccountDeletionService(input: {
  api: CognitoDeletionApi
  repository?: AccountDeletionRepository
  deleteMediaObject?: DeleteMediaObject
}) {
  const repository = input.repository ?? accountDeletionRepository
  const deleteMedia = input.deleteMediaObject ?? runtimeDeleteMediaObject

  async function deleteCollectedMedia(paths: string[]) {
    const unique = [...new Set(paths.filter(isFirstPartyStoragePath))]
    if (!unique.length) return

    const results = await Promise.allSettled(unique.map((path) => deleteMedia(path)))
    const failures = results.filter((result) => result.status === 'rejected').length
    if (failures > 0) {
      console.error('[account_deletion_media_cleanup_incomplete]', {
        attempted: unique.length,
        failures,
      })
    }
  }

  return {
    async deleteAccount(inputValue: {
      profileId: string
      email: string | null
      password: string
    }) {
      const email = inputValue.email?.trim().toLowerCase()
      if (!email) {
        throw new AccountDeletionError('account_deletion_reauthentication_unavailable')
      }

      let reauthenticated: CognitoSignInResult
      try {
        reauthenticated = await input.api.signIn({
          username: email,
          password: inputValue.password,
        })
      } catch (error) {
        if (error instanceof CognitoApiError && (
          error.code === 'NotAuthorizedException'
          || error.code === 'UserNotFoundException'
        )) {
          throw new AccountDeletionError('account_deletion_reauthentication_failed')
        }
        throw new AccountDeletionError('account_deletion_reauthentication_unavailable')
      }

      if (reauthenticated.kind !== 'authenticated') {
        throw new AccountDeletionError('account_deletion_reauthentication_unavailable')
      }

      let identityDeleted = false
      let mediaPaths: string[] = []
      try {
        const result = await repository.deleteAccountWithIdentity(
          inputValue.profileId,
          async () => {
            await input.api.deleteUser(reauthenticated.authentication.accessToken)
            identityDeleted = true
          },
        )
        mediaPaths = result.mediaPaths
      } catch (error) {
        if (!identityDeleted) throw error

        try {
          const retry = await repository.finalizeAccountDeletion(inputValue.profileId)
          mediaPaths = retry.mediaPaths
        } catch {
          throw new AccountDeletionError('account_deletion_cleanup_failed')
        }
      }

      await deleteCollectedMedia(mediaPaths)
      return { ok: true as const }
    },
  }
}
