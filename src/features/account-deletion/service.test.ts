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
    expect(repository.deleteAccountWithIdentity).toHaveBeenCalledWith(profileId, expect.any(Function), { currentSub: null })
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
    expect(repository.finalizeAccountDeletion).toHaveBeenCalledWith(profileId, { currentSub: null })
  })

  it('turns off auto-renew first and deletes nothing when that fails', async () => {
    const api = {
      signIn: vi.fn(async () => ({ kind: 'authenticated' as const, authentication: { accessToken: 'fresh-token', expiresIn: 3600 } })),
      deleteUser: vi.fn(async () => undefined),
    }
    const repository = {
      deleteAccountWithIdentity: vi.fn(async () => ({ mediaPaths: [] as string[] })),
      finalizeAccountDeletion: vi.fn(async () => ({ mediaPaths: [] as string[] })),
    }
    const stopAutoRenew = vi.fn(async () => { throw new Error('cashfree_down') })
    const service = createAccountDeletionService({ api, repository, deleteMediaObject: vi.fn(), effects: { stopAutoRenew, log: vi.fn() } })

    await expect(service.deleteAccount({ profileId, email: 'captain@example.com', password: 'CorrectPassword123' }))
      .rejects.toMatchObject({ code: 'account_deletion_billing_cancel_failed' })
    expect(stopAutoRenew).toHaveBeenCalledWith(profileId)
    expect(repository.deleteAccountWithIdentity).not.toHaveBeenCalled()
    expect(api.deleteUser).not.toHaveBeenCalled()
  })

  it('after the commit refunds cancelled tickets, tells attendees and removes other sign-ins, without undoing anything on failure', async () => {
    const api = {
      signIn: vi.fn(async () => ({ kind: 'authenticated' as const, authentication: { accessToken: 'fresh-token', expiresIn: 3600 } })),
      deleteUser: vi.fn(async () => undefined),
    }
    const calls: string[] = []
    const repository = {
      deleteAccountWithIdentity: vi.fn(async (_id: string, deleteIdentity: () => Promise<void>) => {
        calls.push('database')
        await deleteIdentity()
        return {
          mediaPaths: [],
          refundOrderIds: ['order-1', 'order-2'],
          cancelledEventAttendees: [{ profileId: 'attendee-1', eventId: 'event-1', eventTitle: 'Tanker safety' }],
          otherSignInUsernames: ['phone-user'],
        }
      }),
      finalizeAccountDeletion: vi.fn(async () => ({ mediaPaths: [] as string[] })),
    }
    const log = vi.fn()
    const effects = {
      stopAutoRenew: vi.fn(async () => { calls.push('auto-renew') }),
      refundTicket: vi.fn(async (orderId: string) => { if (orderId === 'order-2') throw new Error('gateway') }),
      notifyEventCancelled: vi.fn(async () => undefined),
      deleteOtherSignIn: vi.fn(async () => undefined),
      log,
    }
    const service = createAccountDeletionService({ api, repository, deleteMediaObject: vi.fn(), effects })

    await expect(service.deleteAccount({ profileId, email: 'captain@example.com', password: 'CorrectPassword123', cognitoSub: 'email-sub' })).resolves.toEqual({ ok: true })
    expect(calls).toEqual(['auto-renew', 'database'])
    expect(repository.deleteAccountWithIdentity).toHaveBeenCalledWith(profileId, expect.any(Function), { currentSub: 'email-sub' })
    expect(effects.refundTicket).toHaveBeenCalledTimes(2)
    expect(effects.notifyEventCancelled).toHaveBeenCalledWith({ profileId: 'attendee-1', eventId: 'event-1', eventTitle: 'Tanker safety' })
    expect(effects.deleteOtherSignIn).toHaveBeenCalledWith('phone-user')
    expect(log).toHaveBeenCalledWith('account_deletion_refunds_incomplete', { attempted: 2, failures: 1 })
  })
})
