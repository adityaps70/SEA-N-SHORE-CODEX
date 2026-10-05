import { cookies } from 'next/headers'
import { COGNITO_COOKIE_NAMES } from '@/lib/auth/cognito-cookies'
import { getCognitoEnvironment } from '@/lib/env'
import { createCognitoUserAdmin } from '@/features/auth/cognito-user-admin'
import { signInIdentityRepository } from '@/features/auth/sign-in-identity-repository'
import { accessTokenClaims, resolveDeletionReauth, type DeletionReauth } from './reauth'

type SessionUser = { id: string; cognitoSub: string; email: string | null }

/** Which check this session can use before deleting the account. Server only. */
export async function getDeletionReauth(user: SessionUser, now = new Date()): Promise<DeletionReauth> {
  const cookieStore = await cookies()
  const claims = accessTokenClaims(cookieStore.get(COGNITO_COOKIE_NAMES.access)?.value)
  const identities = await signInIdentityRepository.listSignInIdentities(user.id)
  const identity = identities.find((entry) => entry.providerSubject === user.cognitoSub) ?? null
  return resolveDeletionReauth({
    identity,
    sessionEmail: user.email,
    sessionUsername: claims.username,
    authTime: claims.authTime,
    now,
  })
}

/** Removes a Google-federated Cognito user (their token has no self-service scope). */
export function deleteIdentityByUsername(username: string) {
  const environment = getCognitoEnvironment()
  return createCognitoUserAdmin({ userPoolId: environment.AWS_COGNITO_USER_POOL_ID, region: environment.AWS_COGNITO_REGION }).deleteUser(username)
}
