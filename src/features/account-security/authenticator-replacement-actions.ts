'use server'

import QRCode from 'qrcode'
import { revalidatePath } from 'next/cache'
import { CognitoApiError } from '@/lib/auth/cognito-api'
import { MFA_SETTINGS_PATH } from '@/lib/auth/admin-mfa-paths'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { describeMfaStatus } from '@/features/auth/mfa'
import { currentAccessToken, productionCognitoApi } from '@/features/auth/mfa-status'
import { recordAccountSecurityAudit } from './audit'
import { sendAuthenticatorNotice } from './authenticator-notices'
import {
  createAuthenticatorReplacement,
  REPLACEMENT_MESSAGES,
  type ReplacementConfirmResult,
  type ReplacementFinishResult,
  type ReplacementStartResult,
} from './authenticator-replacement'
import { createBackupCodeRepository } from './backup-codes'
import { accountSecurityKey } from './keys'
import { accountQuery, accountTransaction } from './runtime'
import { createSessionRepository } from './session-repository'
import { currentSessionId, sessionGuard } from './session-runtime'

/**
 * Admin two-step (owner, 21 Nov): Settings › Two-step verification › Replace authenticator app. Off until
 * AUTHENTICATOR_REPLACE_ENABLED is "true" (after the Cognito behaviour is confirmed with a test account).
 */
function replacement(profileId: string) {
  const api = productionCognitoApi()
  return createAuthenticatorReplacement({
    enabled: process.env.AUTHENTICATOR_REPLACE_ENABLED === 'true',
    profileId,
    key: accountSecurityKey('mfa-challenge-binding'),
    getAccessToken: currentAccessToken,
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
    currentSessionId: () => currentSessionId(profileId),
    api,
    consumeBackupCode: async (code) => {
      const key = accountSecurityKey('mfa-backup-codes')
      if (!key) return false
      return accountTransaction((query) => createBackupCodeRepository({ query }).consume(profileId, key, code))
    },
    query: accountQuery,
    renderQr: (uri) => QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 240 }),
    finish: (sessionId) => accountTransaction(async (query) => {
      const revoked = await createSessionRepository({ query }).revokeOthers(profileId, sessionId, 'mfa_reset')
      await recordAccountSecurityAudit(query, profileId, 'account.mfa_replaced', { sessionsSignedOut: revoked.length })
      return revoked
    }),
    markRevoked: (ids) => sessionGuard.markRevoked(ids),
    sendNotice: (notice) => sendAuthenticatorNotice({ kind: 'replaced', ...notice }),
  })
}

function failed(error: unknown) {
  // Never the password or a code: only the error name.
  console.error('authenticator_replacement_failed', { name: error instanceof Error ? error.name : null })
}

export async function confirmReplacementAction(_state: ReplacementConfirmResult | null, formData: FormData): Promise<ReplacementConfirmResult> {
  const user = await requireAwsUser()
  try {
    return await replacement(user.id).confirm({
      method: formData.get('method') === 'backup_code' ? 'backup_code' : 'authenticator',
      password: typeof formData.get('password') === 'string' ? String(formData.get('password')) : '',
      code: typeof formData.get('code') === 'string' ? String(formData.get('code')) : '',
    })
  } catch (error) {
    failed(error)
    return { status: 'error', error: REPLACEMENT_MESSAGES.failed }
  }
}

export async function startReplacementAction(pass: string): Promise<ReplacementStartResult> {
  const user = await requireAwsUser()
  try {
    return await replacement(user.id).start(pass)
  } catch (error) {
    failed(error)
    return { status: 'error', error: REPLACEMENT_MESSAGES.failed }
  }
}

export async function finishReplacementAction(_state: ReplacementFinishResult | null, formData: FormData): Promise<ReplacementFinishResult> {
  const user = await requireAwsUser()
  try {
    const result = await replacement(user.id).finish(formData.get('pass'), formData.get('code'))
    if (result.status === 'replaced') revalidatePath(MFA_SETTINGS_PATH)
    return result
  } catch (error) {
    failed(error)
    return { status: 'error', error: REPLACEMENT_MESSAGES.failed }
  }
}
