import { describe, expect, it, vi } from 'vitest'
import type { AdminUserSummary } from './repository'
import { AdminSignInControlError, createAdminUserControlService } from './user-control-service'

const adminId = '11111111-1111-4111-8111-111111111111'
const targetId = '55555555-5555-4555-8555-555555555555'

function setup(options: { effects?: Record<string, ReturnType<typeof vi.fn>> } = {}) {
  const user: AdminUserSummary = {
    id: targetId,
    fullName: 'Capt. Member',
    slug: 'capt-member',
    headline: 'Master Mariner',
    email: 'member@example.com',
    cognitoSubject: 'cognito-sub-member',
    status: 'active',
    isAdministrator: false,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    loginMethods: 3,
    loginKinds: ['email', 'google'],
  }
  // One member, three Cognito users: email + password, Google, and a re-linked Google.
  const signIns = [
    { username: 'f3a1c2d4-0000-4000-8000-000000000001', subject: 'cognito-sub-member', kind: 'email' as const },
    { username: 'google_111', subject: 'cognito-sub-google-1', kind: 'google' as const },
    { username: 'google_222', subject: 'cognito-sub-google-2', kind: 'google' as const },
  ]
  const usernames = signIns.map((signIn) => signIn.username)
  const repository = {
    getAdminUser: vi.fn(async () => user),
    listUserSignIns: vi.fn(async () => signIns),
    setUserAccountStatus: vi.fn(async () => true),
    recordUserDeletionAudit: vi.fn(async () => true),
  }
  const accountDeletionRepository = {
    deleteAccountWithIdentity: vi.fn(async (_profileId: string, deleteIdentity: () => Promise<void>) => {
      await deleteIdentity()
      return { mediaPaths: ['profiles/member/avatar.webp'] }
    }),
    finalizeAccountDeletion: vi.fn(async () => ({ mediaPaths: [] as string[] })),
  }
  const identityAdmin = {
    disableUser: vi.fn<(username: string) => Promise<void>>(async () => undefined),
    enableUser: vi.fn<(username: string) => Promise<void>>(async () => undefined),
    deleteUser: vi.fn<(username: string) => Promise<void>>(async () => undefined),
    globalSignOut: vi.fn<(username: string) => Promise<void>>(async () => undefined),
  }
  const deleteMediaObject = vi.fn(async () => undefined)
  return {
    user,
    usernames,
    repository,
    accountDeletionRepository,
    identityAdmin,
    deleteMediaObject,
    service: createAdminUserControlService({
      repository,
      accountDeletionRepository,
      identityAdmin,
      deleteMediaObject,
      deletionEffects: options.effects ? () => options.effects as never : undefined,
    }),
  }
}

describe('admin user control service', () => {
  it('suspends at the database gate and disables and signs out every one of the member\'s Cognito users', async () => {
    const { service, repository, identityAdmin, usernames } = setup()

    await service.suspendAccount(adminId, targetId, 'Repeated unsafe recruitment messages.')

    expect(repository.setUserAccountStatus).toHaveBeenCalledWith(
      adminId,
      targetId,
      'suspended',
      'Repeated unsafe recruitment messages.',
    )
    expect(identityAdmin.disableUser.mock.calls.map(([username]) => username)).toEqual(usernames)
    expect(identityAdmin.globalSignOut.mock.calls.map(([username]) => username)).toEqual(usernames)
  })

  it('treats a sign-in whose Cognito user is already gone as nothing to suspend or restore', async () => {
    const { service, repository, identityAdmin, user } = setup()
    const gone = Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' })
    const missing = async (username: string) => { if (username === 'f3a1c2d4-0000-4000-8000-000000000001') throw gone }
    identityAdmin.disableUser.mockImplementation(missing)
    identityAdmin.globalSignOut.mockImplementation(missing)
    identityAdmin.enableUser.mockImplementation(missing)

    await expect(service.suspendAccount(adminId, targetId, 'Repeated unsafe recruitment messages.')).resolves.toEqual({ ok: true })
    repository.getAdminUser.mockResolvedValueOnce({ ...user, status: 'suspended' })
    await expect(service.restoreAccount(adminId, targetId, 'Appeal accepted.')).resolves.toEqual({ ok: true })
    expect(repository.setUserAccountStatus).toHaveBeenLastCalledWith(adminId, targetId, 'active', 'Appeal accepted.')
  })

  it('reports a suspension that could not reach every sign-in, after the database gate is closed', async () => {
    const { service, repository, identityAdmin } = setup()
    identityAdmin.disableUser.mockImplementation(async (username: string) => {
      if (username === 'google_222') throw new Error('throttled')
    })

    const error = await service.suspendAccount(adminId, targetId, 'Repeated unsafe recruitment messages.').catch((caught) => caught)

    expect(error).toBeInstanceOf(AdminSignInControlError)
    expect(error).toMatchObject({ message: 'admin_user_cognito_suspend_incomplete', failed: 1, total: 3 })
    expect(repository.setUserAccountStatus).toHaveBeenCalledWith(adminId, targetId, 'suspended', expect.any(String))
    expect(identityAdmin.globalSignOut).toHaveBeenCalledTimes(3)
  })

  it('enables every Cognito user before restoring database access', async () => {
    const { service, repository, identityAdmin, user, usernames } = setup()
    repository.getAdminUser.mockResolvedValueOnce({ ...user, status: 'suspended' })

    await service.restoreAccount(adminId, targetId, 'Appeal accepted.')

    expect(identityAdmin.enableUser.mock.calls.map(([username]) => username)).toEqual(usernames)
    expect(repository.setUserAccountStatus).toHaveBeenCalledWith(
      adminId,
      targetId,
      'active',
      'Appeal accepted.',
    )
  })

  it('keeps a member suspended when one sign-in cannot be enabled', async () => {
    const { service, repository, identityAdmin, user } = setup()
    repository.getAdminUser.mockResolvedValueOnce({ ...user, status: 'suspended' })
    identityAdmin.enableUser.mockImplementation(async (username: string) => {
      if (username === 'google_111') throw new Error('throttled')
    })

    await expect(service.restoreAccount(adminId, targetId, 'Appeal accepted.')).rejects.toMatchObject({
      message: 'admin_user_cognito_restore_incomplete',
      failed: 1,
      total: 3,
    })
    expect(repository.setUserAccountStatus).not.toHaveBeenCalled()
  })

  it('permanently deletes every Cognito user of the member and the account data, then records the reason', async () => {
    const { service, repository, accountDeletionRepository, identityAdmin, deleteMediaObject, usernames } = setup()

    await service.permanentlyDeleteAccount(adminId, targetId, 'Fraudulent account confirmed after review.')

    expect(accountDeletionRepository.deleteAccountWithIdentity).toHaveBeenCalledWith(targetId, expect.any(Function), { currentSub: 'cognito-sub-member' })
    // Once per Cognito user: no sign-in is left behind to create a fresh profile later.
    expect(identityAdmin.deleteUser.mock.calls.map(([username]) => username)).toEqual(usernames)
    expect(deleteMediaObject).toHaveBeenCalledWith('profiles/member/avatar.webp')
    expect(repository.recordUserDeletionAudit).toHaveBeenCalledWith(
      adminId,
      targetId,
      'Fraudulent account confirmed after review.',
    )
  })

  it('retries database finalization if identity deletion succeeds before a failed commit', async () => {
    const { service, accountDeletionRepository, identityAdmin } = setup()
    accountDeletionRepository.deleteAccountWithIdentity.mockImplementationOnce(async (_profileId, deleteIdentity) => {
      await deleteIdentity()
      throw new Error('commit_failed')
    })
    accountDeletionRepository.finalizeAccountDeletion.mockResolvedValueOnce({
      mediaPaths: ['profiles/member/cover.webp'],
    })

    await expect(service.permanentlyDeleteAccount(adminId, targetId, 'Permanent deletion approved.')).resolves.toEqual({ ok: true })
    expect(identityAdmin.deleteUser).toHaveBeenCalledTimes(3)
    expect(accountDeletionRepository.finalizeAccountDeletion).toHaveBeenCalledWith(targetId, { currentSub: 'cognito-sub-member' })
  })

  it('refuses destructive controls for administrators and self actions', async () => {
    const { service, repository, user } = setup()

    repository.getAdminUser.mockResolvedValueOnce({ ...user, id: adminId })
    await expect(service.suspendAccount(adminId, adminId, 'No.')).rejects.toThrow('admin_user_self_action_forbidden')

    repository.getAdminUser.mockResolvedValueOnce({ ...user, isAdministrator: true })
    await expect(service.permanentlyDeleteAccount(adminId, targetId, 'No.')).rejects.toThrow('admin_user_target_administrator_forbidden')
  })

  it('rolls the deletion back when a sign-in cannot be deleted, and treats one already gone as deleted', async () => {
    const { service, accountDeletionRepository, identityAdmin, repository } = setup()
    const gone = Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' })
    identityAdmin.deleteUser.mockImplementation(async (username: string) => {
      if (username === 'google_111') throw gone
      if (username === 'google_222') throw new Error('throttled')
    })

    await expect(service.permanentlyDeleteAccount(adminId, targetId, 'Permanent deletion approved.')).rejects.toMatchObject({
      message: 'admin_user_cognito_delete_incomplete',
      failed: 1,
      total: 3,
    })
    expect(accountDeletionRepository.finalizeAccountDeletion).not.toHaveBeenCalled()
    expect(repository.recordUserDeletionAudit).not.toHaveBeenCalled()

    // The retry deletes what is left; the one already gone is not an error.
    identityAdmin.deleteUser.mockImplementation(async (username: string) => {
      if (username !== 'google_222') throw gone
    })
    await expect(service.permanentlyDeleteAccount(adminId, targetId, 'Permanent deletion approved.')).resolves.toEqual({ ok: true })
  })

  it('refuses deletion when the member has no Cognito user to remove', async () => {
    const { service, repository, accountDeletionRepository } = setup()
    repository.listUserSignIns.mockResolvedValueOnce([])
    await expect(service.permanentlyDeleteAccount(adminId, targetId, 'Permanent deletion approved.')).rejects.toThrow('admin_user_identity_unavailable')
    expect(accountDeletionRepository.deleteAccountWithIdentity).not.toHaveBeenCalled()
  })

  it('uses the member deletion extras: auto-renew off first, then refunds and notices; sign-ins go inside the transaction', async () => {
    const order: string[] = []
    const effects = {
      stopAutoRenew: vi.fn(async () => { order.push('auto-renew') }),
      refundTicket: vi.fn(async () => undefined),
      notifyEventCancelled: vi.fn(async () => undefined),
      deleteOtherSignIn: vi.fn(async () => undefined),
      log: vi.fn(),
    }
    const { service, accountDeletionRepository, repository } = setup({ effects })
    accountDeletionRepository.deleteAccountWithIdentity.mockImplementationOnce(async (_profileId, deleteIdentity) => {
      order.push('database')
      await deleteIdentity()
      return { mediaPaths: [], refundOrderIds: ['order-1'], cancelledEventAttendees: [{ profileId: 'a1', eventId: 'e1', eventTitle: 'Drill' }], otherSignInUsernames: ['phone-user'] } as never
    })

    await expect(service.permanentlyDeleteAccount(adminId, targetId, 'Permanent deletion approved.')).resolves.toEqual({ ok: true })
    expect(order).toEqual(['auto-renew', 'database'])
    expect(effects.stopAutoRenew).toHaveBeenCalledWith(targetId)
    expect(effects.refundTicket).toHaveBeenCalledWith('order-1')
    expect(effects.notifyEventCancelled).toHaveBeenCalledWith({ profileId: 'a1', eventId: 'e1', eventTitle: 'Drill' })
    // Every sign-in was already deleted through the admin identity control before the commit.
    expect(effects.deleteOtherSignIn).not.toHaveBeenCalled()
    expect(repository.recordUserDeletionAudit).toHaveBeenCalled()
  })

  it('deletes nothing when Cashfree does not confirm auto-renew is off', async () => {
    const effects = { stopAutoRenew: vi.fn(async () => { throw new Error('gateway') }), log: vi.fn() }
    const { service, accountDeletionRepository, identityAdmin, repository } = setup({ effects })
    await expect(service.permanentlyDeleteAccount(adminId, targetId, 'Permanent deletion approved.')).rejects.toThrow('admin_user_billing_cancel_failed')
    expect(accountDeletionRepository.deleteAccountWithIdentity).not.toHaveBeenCalled()
    expect(identityAdmin.deleteUser).not.toHaveBeenCalled()
    expect(repository.recordUserDeletionAudit).not.toHaveBeenCalled()
  })
})
