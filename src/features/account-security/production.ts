import { cookies } from 'next/headers'
import { CognitoApiError } from '@/lib/auth/cognito-api'
import { COGNITO_COOKIE_NAMES, createCognitoCookieManager } from '@/lib/auth/cognito-cookies'
import { isDisposableEmail } from '@/lib/auth/disposable-email'
import { getCognitoEnvironment, publicEnvironment } from '@/lib/env'
import { describeMfaStatus } from '@/features/auth/mfa'
import { currentAccessToken, productionCognitoApi } from '@/features/auth/mfa-status'
import { createCognitoUserAdmin } from '@/features/auth/cognito-user-admin'
import { resolveProfileIdForCognitoSub } from '@/features/auth/identity-repository'
import { recordAccountSecurityAudit } from './audit'
import { createBackupCodeGeneration, createBackupCodeSignIn } from './backup-code-flows'
import { createBackupCodeRepository } from './backup-codes'
import { createEmailChange, UPDATE_IDENTITY_EMAIL_SQL } from './email-change'
import { maskEmail } from './email-mask'
import { accountSecurityKey } from './keys'
import { verifyMfaChallengeBinding } from './mfa-challenge-binding'
import { createPasswordChange } from './password-change'
import { consumeAccountSecurityAttempt } from './rate-limit'
import { accountQuery, accountTransaction } from './runtime'
import { queueEmailChangedNotice } from './security-emails'
import { createSessionRepository } from './session-repository'
import { currentSessionId, sessionControls, sessionGuard } from './session-runtime'

/** Round H (H3): the production wiring of the account security flows for one signed-in member. */
export function productionAccountFlows(user: { id: string; cognitoSub: string }) {
  const api = productionCognitoApi()
  const mfaStatus = async (accessToken: string) => describeMfaStatus(await api.getUserMfaSettings(accessToken), accessToken)

  const changePassword = createPasswordChange({
    changePassword: (input) => api.changePassword(input),
    getAccessToken: currentAccessToken,
    getAccountKind: async (accessToken) => (await mfaStatus(accessToken)).kind,
    allowAttempt: () => accountTransaction((query) => consumeAccountSecurityAttempt(query, user.id, 'password_change')),
    signOutOtherSessions: async () => sessionControls.signOutOtherSessions(user.id, await currentSessionId(user.id), 'password_changed'),
    audit: (signedOut) => recordAccountSecurityAudit(accountQuery, user.id, 'account.password_changed', { otherSessionsSignedOut: signedOut }),
  })

  const emailChange = createEmailChange({
    getAccessToken: currentAccessToken,
    getAccountState: async (accessToken) => {
      const status = await mfaStatus(accessToken)
      return { kind: status.kind, email: status.email }
    },
    requestEmailChange: (input) => api.requestEmailChange(input),
    verifyEmailChange: (input) => api.verifyEmailChange(input),
    isDisposableEmail,
    allowAttempt: (action) => accountTransaction((query) => consumeAccountSecurityAttempt(query, user.id, action)),
    recordChange: ({ oldEmail, newEmail }) => accountTransaction(async (query) => {
      await query(UPDATE_IDENTITY_EMAIL_SQL, [user.id, user.cognitoSub, newEmail])
      if (oldEmail) await queueEmailChangedNotice(query, { profileId: user.id, oldEmail, maskedNewEmail: maskEmail(newEmail) })
      await recordAccountSecurityAudit(query, user.id, 'account.email_changed')
    }),
  })

  const generateBackupCodes = createBackupCodeGeneration({
    getAccessToken: currentAccessToken,
    getMfaStatus: mfaStatus,
    verifyPassword: async ({ email, password }) => {
      try {
        const result = await api.signIn({ username: email, password })
        // A member with an app that is on always gets the authenticator challenge (no tokens). Should Cognito sign
        // in directly, the stray refresh token is revoked at once.
        if (result.kind === 'authenticated' && result.authentication.refreshToken) {
          await api.revokeToken(result.authentication.refreshToken).catch(() => undefined)
        }
        return true
      } catch (error) {
        if (error instanceof CognitoApiError && ['NotAuthorizedException', 'UserNotFoundException', 'PasswordResetRequiredException'].includes(error.code)) return false
        throw error
      }
    },
    hasKey: () => accountSecurityKey('mfa-backup-codes') !== null,
    allowAttempt: () => accountTransaction((query) => consumeAccountSecurityAttempt(query, user.id, 'backup_codes_generate')),
    replaceBatch: async () => {
      const key = accountSecurityKey('mfa-backup-codes')
      if (!key) throw new Error('backup_code_key_missing')
      return accountTransaction(async (query) => {
        const batch = await createBackupCodeRepository({ query }).replaceBatch(user.id, key)
        await recordAccountSecurityAudit(
          query,
          user.id,
          batch.replaced ? 'account.mfa_backup_codes_regenerated' : 'account.mfa_backup_codes_generated',
          { count: batch.codes.length },
        )
        return batch
      })
    },
  })

  return { changePassword, emailChange, generateBackupCodes }
}

/** The profile behind the username in an MFA challenge: the identity copy first, then Cognito. */
async function profileIdForChallengeUser(username: string) {
  const rows = await accountQuery(
    `select distinct profile_id from public.identity_accounts
     where provider = 'cognito' and (provider_username = $1 or provider_subject = $1)
     limit 2`,
    [username],
  )
  if (rows.length === 1) return String(rows[0]!.profile_id)
  if (rows.length > 1) return null
  const sub = await createCognitoUserAdmin().findSubByUsername(username)
  return sub ? resolveProfileIdForCognitoSub(sub) : null
}

/** Round H (H3): "Use a backup code" on the 2FA sign-in screen. */
export async function productionBackupCodeSignIn() {
  const cookieStore = await cookies()
  const environment = getCognitoEnvironment()
  const cookieManager = createCognitoCookieManager(
    cookieStore as unknown as Parameters<typeof createCognitoCookieManager>[0],
    publicEnvironment.NEXT_PUBLIC_SITE_URL,
    { allowInsecureHttp: environment.AWS_COGNITO_ALLOW_INSECURE_HTTP_COOKIES },
  )

  return createBackupCodeSignIn({
    readChallenge: () => {
      const session = cookieStore.get(COGNITO_COOKIE_NAMES.mfaChallenge)?.value
      const username = cookieStore.get(COGNITO_COOKIE_NAMES.mfaChallengeUser)?.value
      if (!session || !username) return null
      return { session, username, binding: cookieStore.get(COGNITO_COOKIE_NAMES.mfaChallengeBinding)?.value ?? null }
    },
    verifyBinding: (challenge) => verifyMfaChallengeBinding(accountSecurityKey('mfa-challenge-binding'), challenge),
    resolveProfileId: profileIdForChallengeUser,
    allowAttempt: (profileId) => accountTransaction((query) => consumeAccountSecurityAttempt(query, profileId, 'backup_code_sign_in')),
    useCodeAndReset: async ({ profileId, username, code }) => {
      const key = accountSecurityKey('mfa-backup-codes')
      if (!key) throw new Error('backup_code_key_missing')
      const outcome = await accountTransaction(async (query) => {
        const codes = createBackupCodeRepository({ query })
        if (!(await codes.consume(profileId, key, code))) return { result: 'no_match' as const, revoked: [] as string[] }
        // Inside the transaction: if Cognito refuses, the code stays unused.
        await createCognitoUserAdmin().disableSoftwareTokenMfa(username)
        await codes.removeUnused(profileId)
        const revoked = await createSessionRepository({ query }).revokeOthers(profileId, null, 'mfa_reset')
        await recordAccountSecurityAudit(query, profileId, 'account.mfa_backup_code_used')
        await recordAccountSecurityAudit(query, profileId, 'account.mfa_reset', { sessionsSignedOut: revoked.length })
        return { result: 'reset' as const, revoked }
      })
      sessionGuard.markRevoked(outcome.revoked)
      return outcome.result
    },
    clearChallenge: () => cookieManager.clearMfaChallenge(),
  })
}

export { sessionControls, currentSessionId }
