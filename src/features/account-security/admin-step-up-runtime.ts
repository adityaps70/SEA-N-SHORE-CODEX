import { CognitoApiError } from '@/lib/auth/cognito-api'
import { describeMfaStatus } from '@/features/auth/mfa'
import { currentAccessToken, productionCognitoApi } from '@/features/auth/mfa-status'
import { holdsAdminRole } from '@/features/admin/admin-roles'
import { createAdminStepUp, sessionHasAdminStepUp } from './admin-step-up'
import { recordAccountSecurityAudit } from './audit'
import { createBackupCodeRepository } from './backup-codes'
import { accountSecurityKey } from './keys'
import { accountQuery, accountTransaction } from './runtime'
import { currentSessionId } from './session-runtime'

/** Hotfix P1: the production wiring of the admin step-up (admin-step-up.ts). Server only. */

/** True when this request's sign-in made the admin step-up and is still live. Errors refuse (fail closed). */
export async function hasAdminStepUp(profileId: string): Promise<boolean> {
  try {
    const sessionId = await currentSessionId(profileId)
    if (!sessionId) return false
    return await sessionHasAdminStepUp(accountQuery, { profileId, sessionId })
  } catch {
    return false
  }
}

export function productionAdminStepUp(user: { id: string }) {
  const api = productionCognitoApi()
  return createAdminStepUp({
    profileId: user.id,
    // Round GP (Part C follow-up): a country admin on a Google sign-in confirms the same way. The step-up only proves
    // the authenticator was answered; what each role may open is decided elsewhere.
    isPlatformAdministrator: () => holdsAdminRole(user.id),
    getAccount: async () => {
      const accessToken = await currentAccessToken()
      if (!accessToken) return null
      try {
        const settings = await api.getUserMfaSettings(accessToken)
        return { username: settings.username, status: describeMfaStatus(settings, accessToken) }
      } catch (error) {
        if (error instanceof CognitoApiError && error.code === 'NotAuthorizedException') return null
        throw error
      }
    },
    currentSessionId: () => currentSessionId(user.id),
    api,
    consumeBackupCode: async (code) => {
      const key = accountSecurityKey('mfa-backup-codes')
      if (!key) return false
      return accountTransaction((query) => createBackupCodeRepository({ query }).consume(user.id, key, code))
    },
    query: accountQuery,
    audit: (method) => recordAccountSecurityAudit(accountQuery, user.id, 'account.admin_step_up', { method }),
  })
}
