import { describe, expect, it, vi } from 'vitest'
import type { AdminUserSummary } from './repository'
import { createAdminUserControlService } from './user-control-service'

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
  }
  const repository = {
    getAdminUser: vi.fn(async () => user),
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
    disableUser: vi.fn(async () => undefined),
    enableUser: vi.fn(async () => undefined),
    deleteUser: vi.fn(async () => undefined),
    globalSignOut: vi.fn(async () => undefined),
  }
  const deleteMediaObject = vi.fn(async () => undefined)
  return {
    user,
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
  it('suspends at the database gate and revokes the Cognito user session', async () => {
    const { service, repository, identityAdmin } = setup()

    await service.suspendAccount(adminId, targetId, 'Repeated unsafe recruitment messages.')

    expect(repository.setUserAccountStatus).toHaveBeenCalledWith(
      adminId,
      targetId,
      'suspended',
      'Repeated unsafe recruitment messages.',
    )
    expect(identityAdmin.disableUser).toHaveBeenCalledWith('member@example.com')
    expect(identityAdmin.globalSignOut).toHaveBeenCalledWith('member@example.com')
  })

  it('enables Cognito before restoring database access', async () => {
    const { service, repository, identityAdmin, user } = setup()
    repository.getAdminUser.mockResolvedValueOnce({ ...user, status: 'suspended' })

    await service.restoreAccount(adminId, targetId, 'Appeal accepted.')

    expect(identityAdmin.enableUser).toHaveBeenCalledWith('member@example.com')
    expect(repository.setUserAccountStatus).toHaveBeenCalledWith(
      adminId,
      targetId,
      'active',
      'Appeal accepted.',
    )
  })

  it('permanently deletes Cognito identity and associated account data, then records the reason', async () => {
    const { service, repository, accountDeletionRepository, identityAdmin, deleteMediaObject } = setup()

    await service.permanentlyDeleteAccount(adminId, targetId, 'Fraudulent account confirmed after review.')

    expect(accountDeletionRepository.deleteAccountWithIdentity).toHaveBeenCalledWith(targetId, expect.any(Function), { currentSub: 'cognito-sub-member' })
    expect(identityAdmin.deleteUser).toHaveBeenCalledWith('member@example.com')
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
    expect(identityAdmin.deleteUser).toHaveBeenCalledTimes(1)
    expect(accountDeletionRepository.finalizeAccountDeletion).toHaveBeenCalledWith(targetId, { currentSub: 'cognito-sub-member' })
  })

  it('refuses destructive controls for administrators and self actions', async () => {
    const { service, repository, user } = setup()

    repository.getAdminUser.mockResolvedValueOnce({ ...user, id: adminId })
    await expect(service.suspendAccount(adminId, adminId, 'No.')).rejects.toThrow('admin_user_self_action_forbidden')

    repository.getAdminUser.mockResolvedValueOnce({ ...user, isAdministrator: true })
    await expect(service.permanentlyDeleteAccount(adminId, targetId, 'No.')).rejects.toThrow('admin_user_target_administrator_forbidden')
  })

  it('uses the member deletion extras: auto-renew off first, then refunds, notices and other sign-ins', async () => {
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
    expect(effects.deleteOtherSignIn).toHaveBeenCalledWith('phone-user')
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
