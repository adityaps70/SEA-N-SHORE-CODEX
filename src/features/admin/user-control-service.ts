import { deleteMediaObject as runtimeDeleteMediaObject } from '@/lib/aws/storage'
import { accountDeletionRepository } from '@/features/account-deletion/repository'
import {
  AccountDeletionError,
  createAccountDeletionService,
  type AccountDeletionEffects,
} from '@/features/account-deletion/service'
import { adminRepository, type AdminRepository, type AdminUserSummary } from './repository'

type AdminUserRepository = Pick<
  AdminRepository,
  'getAdminUser' | 'setUserAccountStatus' | 'recordUserDeletionAudit'
>

type AccountDeletionRepository = Pick<
  typeof accountDeletionRepository,
  'deleteAccountWithIdentity' | 'finalizeAccountDeletion'
>

export type AdminIdentityControl = {
  disableUser(username: string): Promise<void>
  enableUser(username: string): Promise<void>
  deleteUser(username: string): Promise<void>
  globalSignOut(username: string): Promise<void>
}

type DeleteMediaObject = (key: string) => Promise<void>

function targetUsername(target: AdminUserSummary) {
  return target.email?.trim() || target.cognitoSubject?.trim() || null
}

function assertControllableTarget(adminId: string, target: AdminUserSummary | null) {
  if (!target) throw new Error('admin_user_not_found')
  if (target.id === adminId) throw new Error('admin_user_self_action_forbidden')
  if (target.isAdministrator) throw new Error('admin_user_target_administrator_forbidden')
  return target
}

export function createAdminUserControlService(input: {
  repository?: AdminUserRepository
  accountDeletionRepository?: AccountDeletionRepository
  identityAdmin: AdminIdentityControl
  deleteMediaObject?: DeleteMediaObject
  /** Same extras as member deletion: auto-renew off, refunds, attendee notices, other sign-ins. */
  deletionEffects?: () => AccountDeletionEffects
}) {
  const repository = input.repository ?? adminRepository
  const deletionRepository = input.accountDeletionRepository ?? accountDeletionRepository
  const deleteMedia = input.deleteMediaObject ?? runtimeDeleteMediaObject

  async function loadTarget(adminId: string, targetId: string) {
    return assertControllableTarget(adminId, await repository.getAdminUser(adminId, targetId))
  }

  return {
    async suspendAccount(adminId: string, targetId: string, reason: string) {
      const target = await loadTarget(adminId, targetId)
      if (target.status === 'deletion_requested') throw new Error('admin_user_deleted')

      await repository.setUserAccountStatus(adminId, targetId, 'suspended', reason)

      const username = targetUsername(target)
      if (username) {
        const results = await Promise.allSettled([
          input.identityAdmin.disableUser(username),
          input.identityAdmin.globalSignOut(username),
        ])
        if (results.some((result) => result.status === 'rejected')) {
          console.error('[admin_user_cognito_suspend_incomplete]', { targetId })
        }
      }
      return { ok: true as const }
    },

    async restoreAccount(adminId: string, targetId: string, reason: string) {
      const target = await loadTarget(adminId, targetId)
      if (target.status !== 'suspended') throw new Error('admin_user_restore_forbidden')

      const username = targetUsername(target)
      if (username) await input.identityAdmin.enableUser(username)
      await repository.setUserAccountStatus(adminId, targetId, 'active', reason)
      return { ok: true as const }
    },

    async permanentlyDeleteAccount(adminId: string, targetId: string, reason: string) {
      const target = await loadTarget(adminId, targetId)
      if (target.status === 'deletion_requested') throw new Error('admin_user_deleted')
      const username = targetUsername(target)
      if (!username) throw new Error('admin_user_identity_unavailable')

      // The member deletion service, with the administrator's check instead of a password:
      // the same per-organization plan, auto-renew off first, refunds and notices.
      const deletion = createAccountDeletionService({
        api: {
          signIn: async () => { throw new Error('admin_deletion_has_no_password_step') },
          deleteUser: async () => { throw new Error('admin_deletion_uses_admin_identity_control') },
        },
        repository: deletionRepository,
        deleteMediaObject: deleteMedia,
        effects: input.deletionEffects?.() ?? {},
      })
      try {
        await deletion.deleteVerifiedAccount({
          profileId: targetId,
          cognitoSub: target.cognitoSubject ?? null,
          deleteIdentity: () => input.identityAdmin.deleteUser(username),
        })
      } catch (error) {
        if (error instanceof AccountDeletionError && error.code === 'account_deletion_cleanup_failed') throw new Error('admin_user_cleanup_failed')
        if (error instanceof AccountDeletionError && error.code === 'account_deletion_billing_cancel_failed') throw new Error('admin_user_billing_cancel_failed')
        throw error
      }

      await repository.recordUserDeletionAudit(adminId, targetId, reason)
      return { ok: true as const }
    },
  }
}
