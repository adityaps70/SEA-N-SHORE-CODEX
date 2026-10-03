import { cookies } from 'next/headers'
import { createCognitoApi } from '@/lib/auth/cognito-api'
import { COGNITO_COOKIE_NAMES } from '@/lib/auth/cognito-cookies'
import { getCognitoEnvironment, publicEnvironment } from '@/lib/env'
import { createPhoneAuthAdmin } from '@/features/auth/phone-auth-admin'
import { phoneLinkRepository } from '@/features/auth/phone-link-repository'
import { accessTokenClaims, createDeletionCodeService, resolveDeletionReauth, type DeletionReauth } from './reauth'

type SessionUser = { id: string; cognitoSub: string; email: string | null }

/** Which check this session can use before deleting the account. Server only. */
export async function getDeletionReauth(user: SessionUser, now = new Date()): Promise<DeletionReauth> {
  const cookieStore = await cookies()
  const claims = accessTokenClaims(cookieStore.get(COGNITO_COOKIE_NAMES.access)?.value)
  const identities = await phoneLinkRepository.listSignInIdentities(user.id)
  const identity = identities.find((entry) => entry.providerSubject === user.cognitoSub) ?? null
  return resolveDeletionReauth({
    identity,
    sessionEmail: user.email,
    sessionUsername: claims.username,
    authTime: claims.authTime,
    now,
  })
}

export async function runtimeDeletionCodeService() {
  const cookieStore = await cookies()
  const environment = getCognitoEnvironment()
  return createDeletionCodeService({
    api: createCognitoApi({ region: environment.AWS_COGNITO_REGION, clientId: environment.AWS_COGNITO_CLIENT_ID }),
    repository: phoneLinkRepository,
    cookieStore: cookieStore as unknown as Parameters<typeof createDeletionCodeService>[0]['cookieStore'],
    siteUrl: publicEnvironment.NEXT_PUBLIC_SITE_URL,
    allowInsecureHttpCookies: environment.AWS_COGNITO_ALLOW_INSECURE_HTTP_COOKIES,
  })
}

/** Removes the member's own Cognito user with the fresh token from a code check. */
export function deleteIdentityWithAccessToken(accessToken: string) {
  const environment = getCognitoEnvironment()
  return createCognitoApi({ region: environment.AWS_COGNITO_REGION, clientId: environment.AWS_COGNITO_CLIENT_ID }).deleteUser(accessToken)
}

/** Removes a Google-federated Cognito user (their token has no self-service scope). */
export function deleteIdentityByUsername(username: string) {
  const environment = getCognitoEnvironment()
  return createPhoneAuthAdmin({ userPoolId: environment.AWS_COGNITO_USER_POOL_ID, region: environment.AWS_COGNITO_REGION }).deleteUser(username)
}
