'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getAwsVerifiedUser } from '@/features/auth/aws-queries'
import { recordAccountSecurityAudit } from './audit'
import type { BackupCodesState, BackupSignInState } from './backup-code-flows'
import type { EmailChangeState } from './email-change'
import type { PasswordChangeState } from './password-change'
import { ACCOUNT_SETTINGS_PATH } from './paths'
import { currentSessionId, productionAccountFlows, productionBackupCodeSignIn, sessionControls } from './production'
import { accountQuery } from './runtime'

const SESSION_EXPIRED = 'Your session expired. Please sign in again.'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SessionActionState = { status: 'idle' } | { status: 'error'; error: string } | { status: 'done'; message: string }

/** Round H (H3): Settings › Account › Change password. Signs out every other session on success. */
export async function changePasswordAction(state: PasswordChangeState, formData: FormData): Promise<PasswordChangeState> {
  const user = await getAwsVerifiedUser()
  if (!user) return { status: 'error', error: SESSION_EXPIRED }
  const result = await productionAccountFlows(user).changePassword(state, formData)
  if (result.status === 'changed') revalidatePath(ACCOUNT_SETTINGS_PATH)
  return result
}

/** Step 1 of an email change: Cognito sends a code to the new address; nothing switches yet. */
export async function requestEmailChangeAction(state: EmailChangeState, formData: FormData): Promise<EmailChangeState> {
  const user = await getAwsVerifiedUser()
  if (!user) return { status: 'error', error: SESSION_EXPIRED }
  return productionAccountFlows(user).emailChange.requestEmailChange(state, formData)
}

/** Step 2: the code switches the address, then the old address is told. */
export async function confirmEmailChangeAction(state: EmailChangeState, formData: FormData): Promise<EmailChangeState> {
  const user = await getAwsVerifiedUser()
  if (!user) return { status: 'error', error: SESSION_EXPIRED }
  const result = await productionAccountFlows(user).emailChange.confirmEmailChange(state, formData)
  if (result.status === 'changed') revalidatePath(ACCOUNT_SETTINGS_PATH)
  return result
}

/** New 2FA backup codes (the old batch stops working), shown once. */
export async function generateBackupCodesAction(state: BackupCodesState, formData: FormData): Promise<BackupCodesState> {
  const user = await getAwsVerifiedUser()
  if (!user) return { status: 'error', error: SESSION_EXPIRED }
  return productionAccountFlows(user).generateBackupCodes(state, formData)
}

/** Signs one of the member's other devices out. This device signs out with the normal Sign out. */
export async function signOutSessionAction(sessionId: string): Promise<SessionActionState> {
  if (!UUID.test(sessionId)) return { status: 'error', error: 'That session was not found.' }
  const user = await getAwsVerifiedUser()
  if (!user) return { status: 'error', error: SESSION_EXPIRED }
  if ((await currentSessionId(user.id)) === sessionId) return { status: 'error', error: 'Use Sign out to sign out of this device.' }
  const revoked = await sessionControls.signOutSession(user.id, sessionId, 'signed_out_remotely')
  if (!revoked) return { status: 'error', error: 'That session was already signed out.' }
  await recordAccountSecurityAudit(accountQuery, user.id, 'account.sessions_signed_out', { count: 1 }).catch(() => undefined)
  revalidatePath(ACCOUNT_SETTINGS_PATH)
  return { status: 'done', message: 'Signed out of that device.' }
}

/** Signs out every session except this one. */
export async function signOutOtherSessionsAction(): Promise<SessionActionState> {
  const user = await getAwsVerifiedUser()
  if (!user) return { status: 'error', error: SESSION_EXPIRED }
  const count = await sessionControls.signOutOtherSessions(user.id, await currentSessionId(user.id), 'signed_out_other_devices')
  await recordAccountSecurityAudit(accountQuery, user.id, 'account.sessions_signed_out', { count }).catch(() => undefined)
  revalidatePath(ACCOUNT_SETTINGS_PATH)
  return { status: 'done', message: count === 1 ? 'Signed out of 1 other device.' : `Signed out of ${count} other devices.` }
}

/** "Use a backup code" on the 2FA sign-in screen. On success 2FA is reset and the member signs in again. */
export async function signInWithBackupCodeAction(state: BackupSignInState, formData: FormData): Promise<BackupSignInState> {
  const result = await (await productionBackupCodeSignIn())(state, formData)
  if (result.reset) redirect('/auth/sign-in?notice=mfa-reset')
  return result
}
