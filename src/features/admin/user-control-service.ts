import { deleteMediaObject as runtimeDeleteMediaObject } from '@/lib/aws/storage'
import { accountDeletionRepository } from '@/features/account-deletion/repository'
import {
  AccountDeletionError,
  createAccountDeletionService,
  type AccountDeletionEffects,
} from '@/features/account-deletion/service'
import { adminRepository, type AdminRepository, type AdminUserSummary } from './repository'
import { AdminSignInControlError } from './sign-in-control-error'

export { AdminSignInControlError }

type AdminUserRepository = Pick<
  AdminRepository,
  'getAdminUser' | 'listUserSignIns' | 'setUserAccountStatus' | 'recordUserDeletionAudit'
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

function isUserNotFound(error: unknown) {
  return error instanceof Error && error.name === 'UserNotFoundException'
}

/**
 * A sign-in whose Cognito user no longer exists cannot be used, so there is nothing to disable,
 * enable or delete (production has identity rows left from Cognito users replaced since).
 */
async function ignoreMissingUser(action: Promise<void>) {
  try {
    await action
  } catch (error) {
    if (!isUserNotFound(error)) throw error
  }
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

  /** Every Cognito user of the member (email + password, Google, a re-linked Google...). */
  async function signInUsernames(adminId: string, target: AdminUserSummary) {
    const signIns = await repository.listUserSignIns(adminId, target.id)
    return [...new Set(signIns.map((signIn) => signIn.username))]
  }

  return {
    async suspendAccount(adminId: string, targetId: string, reason: string) {
      const target = await loadTarget(adminId, targetId)
      if (target.status === 'deletion_requested') throw new Error('admin_user_deleted')

      // The database gate first: every request re-checks account_status, whichever sign-in it uses.
      await repository.setUserAccountStatus(adminId, targetId, 'suspended', reason)

      const usernames = await signInUsernames(adminId, target)
      const outcomes = await Promise.all(usernames.map(async (username) => {
        const results = await Promise.allSettled([
          ignoreMissingUser(input.identityAdmin.disableUser(username)),
          ignoreMissingUser(input.identityAdmin.globalSignOut(username)),
        ])
        return results.every((result) => result.status === 'fulfilled')
      }))
      const failed = outcomes.filter((ok) => !ok).length
      if (failed) {
        console.error('[admin_user_cognito_suspend_incomplete]', { targetId, failed, total: usernames.length })
        throw new AdminSignInControlError('admin_user_cognito_suspend_incomplete', failed, usernames.length)
      }
      return { ok: true as const }
    },

    async restoreAccount(adminId: string, targetId: string, reason: string) {
      const target = await loadTarget(adminId, targetId)
      if (target.status !== 'suspended') throw new Error('admin_user_restore_forbidden')

      // Every sign-in is enabled before database access returns; if any fails the account stays
      // suspended (enabling again is harmless), so the member is never half restored.
      const usernames = await signInUsernames(adminId, target)
      const results = await Promise.allSettled(usernames.map((username) => ignoreMissingUser(input.identityAdmin.enableUser(username))))
      const failed = results.filter((result) => result.status === 'rejected').length
      if (failed) {
        console.error('[admin_user_cognito_restore_incomplete]', { targetId, failed, total: usernames.length })
        throw new AdminSignInControlError('admin_user_cognito_restore_incomplete', failed, usernames.length)
      }
      await repository.setUserAccountStatus(adminId, targetId, 'active', reason)
      return { ok: true as const }
    },

    async permanentlyDeleteAccount(adminId: string, targetId: string, reason: string) {
      const target = await loadTarget(adminId, targetId)
      if (target.status === 'deletion_requested') throw new Error('admin_user_deleted')
      const usernames = await signInUsernames(adminId, target)
      if (!usernames.length) throw new Error('admin_user_identity_unavailable')

      // The member deletion service, with the administrator's check instead of a password:
      // the same per-organization plan, auto-renew off first, refunds and notices.
      const deletion = createAccountDeletionService({
        api: {
          signIn: async () => { throw new Error('admin_deletion_has_no_password_step') },
          deleteUser: async () => { throw new Error('admin_deletion_uses_admin_identity_control') },
        },
        repository: deletionRepository,
        deleteMediaObject: deleteMedia,
        // Every sign-in is deleted below, inside the deletion transaction, so the member
        // deletion's after-commit "other sign-ins" cleanup has nothing left to do.
        effects: { ...input.deletionEffects?.(), deleteOtherSignIn: undefined },
      })
      try {
        await deletion.deleteVerifiedAccount({
          profileId: targetId,
          cognitoSub: target.cognitoSubject ?? null,
          deleteIdentity: async () => {
            // All of the member's Cognito users, so no sign-in is left to re-create a profile.
            // One already gone counts as deleted (a retry after a partial failure).
            let failed = 0
            for (const username of usernames) {
              try {
                await ignoreMissingUser(input.identityAdmin.deleteUser(username))
              } catch {
                failed += 1
              }
            }
            if (failed) {
              console.error('[admin_user_cognito_delete_incomplete]', { targetId, failed, total: usernames.length })
              throw new AdminSignInControlError('admin_user_cognito_delete_incomplete', failed, usernames.length)
            }
          },
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
