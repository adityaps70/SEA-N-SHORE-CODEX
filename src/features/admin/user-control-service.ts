import { deleteMediaObject as runtimeDeleteMediaObject } from '@/lib/aws/storage'
import { accountDeletionRepository } from '@/features/account-deletion/repository'
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

function isFirstPartyStoragePath(value: string) {
  if (!value.trim()) return false
  try {
    const url = new URL(value)
    return url.protocol !== 'http:' && url.protocol !== 'https:'
  } catch {
    return !value.startsWith('/')
  }
}

export function createAdminUserControlService(input: {
  repository?: AdminUserRepository
  accountDeletionRepository?: AccountDeletionRepository
  identityAdmin: AdminIdentityControl
  deleteMediaObject?: DeleteMediaObject
}) {
  const repository = input.repository ?? adminRepository
  const deletionRepository = input.accountDeletionRepository ?? accountDeletionRepository
  const deleteMedia = input.deleteMediaObject ?? runtimeDeleteMediaObject

  async function loadTarget(adminId: string, targetId: string) {
    return assertControllableTarget(adminId, await repository.getAdminUser(adminId, targetId))
  }

  async function deleteCollectedMedia(paths: string[]) {
    const unique = [...new Set(paths.filter(isFirstPartyStoragePath))]
    if (!unique.length) return
    const results = await Promise.allSettled(unique.map((path) => deleteMedia(path)))
    const failures = results.filter((result) => result.status === 'rejected').length
    if (failures) {
      console.error('[admin_user_deletion_media_cleanup_incomplete]', {
        attempted: unique.length,
        failures,
      })
    }
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

      let identityDeleted = false
      let mediaPaths: string[] = []
      try {
        const result = await deletionRepository.deleteAccountWithIdentity(
          targetId,
          async () => {
            await input.identityAdmin.deleteUser(username)
            identityDeleted = true
          },
        )
        mediaPaths = result.mediaPaths
      } catch (error) {
        if (!identityDeleted) throw error
        try {
          const retry = await deletionRepository.finalizeAccountDeletion(targetId)
          mediaPaths = retry.mediaPaths
        } catch {
          throw new Error('admin_user_cleanup_failed')
        }
      }

      await deleteCollectedMedia(mediaPaths)
      await repository.recordUserDeletionAudit(adminId, targetId, reason)
      return { ok: true as const }
    },
  }
}
