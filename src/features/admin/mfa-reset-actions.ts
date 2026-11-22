'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { createCognitoUserAdmin } from '@/features/auth/cognito-user-admin'
import { createAdminMfaReset, MFA_RESET_REASON_MIN } from '@/features/account-security/admin-mfa-reset'
import { sendAuthenticatorNotice } from '@/features/account-security/authenticator-notices'
import { accountTransaction } from '@/features/account-security/runtime'
import { createSessionRepository } from '@/features/account-security/session-repository'
import { sessionGuard } from '@/features/account-security/session-runtime'
import { ADMIN_MFA_REQUIRED_MESSAGE, adminActionMfaMissing } from './mfa-gate'

/**
 * Admin two-step (owner, 21 Nov): Admin › Users › a member › Reset two-step verification. Platform administrators
 * only (the reset checks the role again in SQL), after the admin MFA gate. Country admins can never use it.
 */
export type MfaResetActionState = { status: 'idle' | 'done' | 'error'; message?: string; revision: number }

const MESSAGES: Record<string, string> = {
  admin_forbidden: 'Only Sea N Shore administrators can reset two-step verification.',
  own_account: 'You cannot reset your own two-step verification here. Use a backup code, or ask another administrator.',
  reason_required: `Say why, in at least ${MFA_RESET_REASON_MIN} characters (it goes into the audit log).`,
  confirmation_mismatch: 'Type the member’s @username exactly to confirm.',
  member_not_found: 'This member could not be found.',
  no_cognito_sign_in: 'This member has no email-and-password sign-in, so there is no authenticator app to reset.',
}

const inputSchema = z.object({
  profileId: z.string().uuid(),
  reason: z.string().max(1000),
  confirmUsername: z.string().max(120),
})

export async function resetMemberTwoStepAction(previous: MfaResetActionState, formData: FormData): Promise<MfaResetActionState> {
  const revision = previous.revision + 1
  const parsed = inputSchema.safeParse({
    profileId: formData.get('profileId'),
    reason: String(formData.get('reason') ?? ''),
    confirmUsername: String(formData.get('confirmUsername') ?? ''),
  })
  if (!parsed.success) return { status: 'error', message: 'Check the form and try again.', revision }
  let adminId: string
  try {
    adminId = (await requireAwsUser()).id
  } catch {
    return { status: 'error', message: 'Your session may have expired. Sign in again.', revision }
  }
  if (await adminActionMfaMissing(adminId)) return { status: 'error', message: ADMIN_MFA_REQUIRED_MESSAGE, revision }

  const reset = createAdminMfaReset({
    transaction: accountTransaction,
    disableSoftwareTokenMfa: (username) => createCognitoUserAdmin().disableSoftwareTokenMfa(username),
    revokeAllSessions: (query, profileId) => createSessionRepository({ query }).revokeOthers(profileId, null, 'mfa_reset'),
    markRevoked: (ids) => sessionGuard.markRevoked(ids),
    sendNotice: (notice) => sendAuthenticatorNotice({ kind: 'reset_by_admin', ...notice }),
  })
  try {
    const result = await reset({ adminId, ...parsed.data })
    if (result.status === 'error') return { status: 'error', message: MESSAGES[result.code], revision }
    revalidatePath(`/admin/users/${parsed.data.profileId}`)
    return {
      status: 'done',
      message: `Two-step verification was reset and ${result.sessionsSignedOut === 1 ? '1 session was' : `${result.sessionsSignedOut} sessions were`} signed out. ${result.emailed ? 'The member was emailed.' : 'The email could not be sent; tell the member another way.'}`,
      revision,
    }
  } catch (error) {
    console.warn('[mfa_reset_by_admin_failed]', { code: error instanceof Error ? error.name.slice(0, 60) : 'unknown' })
    return { status: 'error', message: 'Two-step verification could not be reset. Nothing was changed. Please try again.', revision }
  }
}
