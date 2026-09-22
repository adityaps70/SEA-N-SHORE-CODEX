import { describe, expect, it, vi } from 'vitest'
import { CognitoApiError } from '@/lib/auth/cognito-api'
import { createAccountDeletionService } from './service'

const profileId = '11111111-1111-4111-8111-111111111111'

function setup() {
  const api = {
    signIn: vi.fn(async () => ({
      kind: 'authenticated' as const,
      authentication: { accessToken: 'fresh-token', expiresIn: 3600 },
    })),
    deleteUser: vi.fn(async () => undefined),
  }
  const repository = {
    deleteAccountWithIdentity: vi.fn(async (_profileId: string, deleteIdentity: () => Promise<void>) => {
      await deleteIdentity()
      return {
        mediaPaths: [
          `profiles/${profileId}/avatar.webp`,
          'https://legacy.example/banner.jpg',
          '',
        ],
      }
    }),
    finalizeAccountDeletion: vi.fn(async () => ({ mediaPaths: [] as string[] })),
  }
  const deleteMediaObject = vi.fn(async () => undefined)

  return {
    api,
    repository,
    deleteMediaObject,
    service: createAccountDeletionService({ api, repository, deleteMediaObject }),
  }
}

describe('account deletion service', () => {
  it('requires password re-authentication before deleting Cognito and database account data', async () => {
    const { service, api, repository, deleteMediaObject } = setup()

    await expect(service.deleteAccount({
      profileId,
      email: 'captain@example.com',
      password: 'CorrectPassword123',
    })).resolves.toEqual({ ok: true })

    expect(api.signIn).toHaveBeenCalledWith({
      username: 'captain@example.com',
      password: 'CorrectPassword123',
    })
    expect(repository.deleteAccountWithIdentity).toHaveBeenCalledWith(profileId, expect.any(Function))
    expect(api.deleteUser).toHaveBeenCalledWith('fresh-token')
    expect(deleteMediaObject).toHaveBeenCalledWith(`profiles/${profileId}/avatar.webp`)
    expect(deleteMediaObject).not.toHaveBeenCalledWith('https://legacy.example/banner.jpg')
  })

  it('rejects an incorrect password without touching account data', async () => {
    const { service, api, repository } = setup()
    api.signIn.mockRejectedValueOnce(new CognitoApiError('NotAuthorizedException'))

    await expect(service.deleteAccount({
      profileId,
      email: 'captain@example.com',
      password: 'WrongPassword123',
    })).rejects.toMatchObject({ code: 'account_deletion_reauthentication_failed' })

    expect(repository.deleteAccountWithIdentity).not.toHaveBeenCalled()
    expect(api.deleteUser).not.toHaveBeenCalled()
  })

  it('rejects deletion when the signed-in account has no password re-auth identity', async () => {
    const { service, api, repository } = setup()

    await expect(service.deleteAccount({
      profileId,
      email: null,
      password: 'CorrectPassword123',
    })).rejects.toMatchObject({ code: 'account_deletion_reauthentication_unavailable' })

    expect(api.signIn).not.toHaveBeenCalled()
    expect(repository.deleteAccountWithIdentity).not.toHaveBeenCalled()
  })

  it('retries database finalization if Cognito deletion succeeded but the transaction did not commit', async () => {
    const { service, api, repository } = setup()
    repository.deleteAccountWithIdentity.mockImplementationOnce(async (_profileId, deleteIdentity) => {
      await deleteIdentity()
      throw new Error('commit_failed')
    })
    repository.finalizeAccountDeletion.mockResolvedValueOnce({
      mediaPaths: [`profiles/${profileId}/cover.webp`],
    })

    await expect(service.deleteAccount({
      profileId,
      email: 'captain@example.com',
      password: 'CorrectPassword123',
    })).resolves.toEqual({ ok: true })

    expect(api.deleteUser).toHaveBeenCalledTimes(1)
    expect(repository.finalizeAccountDeletion).toHaveBeenCalledWith(profileId)
  })
})
