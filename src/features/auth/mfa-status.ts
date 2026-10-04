import { cookies } from 'next/headers'
import { cache } from 'react'
import { CognitoApiError, createCognitoApi } from '@/lib/auth/cognito-api'
import { COGNITO_COOKIE_NAMES } from '@/lib/auth/cognito-cookies'
import { getCognitoEnvironment } from '@/lib/env'
import { describeMfaStatus, type CurrentMfaStatus } from './mfa'

export function productionCognitoApi() {
  const environment = getCognitoEnvironment()
  return createCognitoApi({
    region: environment.AWS_COGNITO_REGION,
    clientId: environment.AWS_COGNITO_CLIENT_ID,
  })
}

export async function currentAccessToken(): Promise<string | null> {
  return (await cookies()).get(COGNITO_COOKIE_NAMES.access)?.value ?? null
}

/**
 * Round 14 (2.11): the signed-in member's authenticator-app status, read fresh from Cognito with
 * their own access token (GetUser) and cached for the rest of this request only. Null when there
 * is no valid session. Other Cognito failures throw, so the admin gate fails closed.
 */
export const getCurrentMfaStatus = cache(async (): Promise<CurrentMfaStatus | null> => {
  const accessToken = await currentAccessToken()
  if (!accessToken) return null
  try {
    return describeMfaStatus(await productionCognitoApi().getUserMfaSettings(accessToken), accessToken)
  } catch (error) {
    if (error instanceof CognitoApiError && error.code === 'NotAuthorizedException') return null
    throw error
  }
})
