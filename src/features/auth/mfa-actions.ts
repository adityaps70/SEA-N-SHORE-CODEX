'use server'

import QRCode from 'qrcode'
import { revalidatePath } from 'next/cache'
import { holdsAdminRole } from '@/features/admin/admin-roles'
import { MFA_SETTINGS_PATH } from '@/lib/auth/admin-mfa-paths'
import { requireAwsUser } from './aws-queries'
import {
  createAuthenticatorMfaActions,
  type MfaChangeState,
  type MfaSetupStartState,
} from './mfa'
import { currentAccessToken, productionCognitoApi } from './mfa-status'

function productionMfaActions() {
  return createAuthenticatorMfaActions({
    api: productionCognitoApi(),
    getAccessToken: currentAccessToken,
    getProfileId: async () => (await requireAwsUser()).id,
    // Round GP (Part C follow-up): country admins must keep two-step verification on too.
    isPlatformAdministrator: (profileId) => holdsAdminRole(profileId),
    renderQr: (uri) => QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 240 }),
  })
}

/** Round 14 (2.11): step 1 of authenticator setup — a new secret, its otpauth:// QR code and the key. */
export async function startAuthenticatorSetup(): Promise<MfaSetupStartState> {
  return productionMfaActions().startSetup()
}

/** Step 2: checks a code from the app, then turns authenticator MFA on (and preferred). */
export async function confirmAuthenticatorSetup(state: MfaChangeState, formData: FormData): Promise<MfaChangeState> {
  const result = await productionMfaActions().confirmSetup(state, formData)
  if (result.status === 'enabled') revalidatePath(MFA_SETTINGS_PATH)
  return result
}

/** Turns authenticator MFA off. Refused for platform administrators and country admins. */
export async function disableAuthenticator(): Promise<MfaChangeState> {
  const result = await productionMfaActions().disable()
  if (result.status === 'disabled') revalidatePath(MFA_SETTINGS_PATH)
  return result
}
