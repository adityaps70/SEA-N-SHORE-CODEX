import { cookies } from 'next/headers'
import { cache } from 'react'
import { CognitoApiError, createCognitoApi, type CognitoPrincipal } from '@/lib/auth/cognito-api'
import { COGNITO_COOKIE_NAMES } from '@/lib/auth/cognito-cookies'
import { createCognitoPrincipalResolver } from '@/lib/auth/cognito-principal-cache'
import { getCognitoEnvironment } from '@/lib/env'
import { checkCurrentSession } from '@/features/account-security/session-runtime'
import {
  getProfileAccountStatus,
  provisionProfileForCognitoPrincipal,
  resolveProfileIdForCognitoSub,
} from './identity-repository'

export type AwsVerifiedUser = {
  id: string
  cognitoSub: string
  email: string | null
}

type GetPrincipal = () => Promise<CognitoPrincipal | null>
type ResolveProfileId = (sub: string) => Promise<string | null>
type ProvisionProfileId = (principal: CognitoPrincipal) => Promise<string>
type GetProfileAccountStatus = (profileId: string) => Promise<'active' | 'restricted' | 'suspended' | 'deletion_requested' | null>
type CacheVerifiedUser = <T>(loader: () => Promise<T>) => () => Promise<T>
/** Round H (H3): this device's session state (see features/account-security/session-guard). */
type CheckSession = (profileId: string) => Promise<{ status: 'active' | 'revoked' | 'untracked' }>

export type AwsVerification = {
  user: AwsVerifiedUser | null
  /** True when the Cognito tokens are valid but this device was signed out (Settings › Account). */
  sessionRevoked: boolean
}

export class AwsAuthenticationRequiredError extends Error {
  constructor() {
    super('Authentication required.')
    this.name = 'AwsAuthenticationRequiredError'
  }
}

export function createAwsAuthQueries(input: {
  getPrincipal: GetPrincipal
  resolveProfileId: ResolveProfileId
  provisionProfileId: ProvisionProfileId
  getProfileAccountStatus: GetProfileAccountStatus
  cacheVerifiedUser?: CacheVerifiedUser
  checkSession?: CheckSession
}) {
  const signedOut: AwsVerification = { user: null, sessionRevoked: false }

  async function loadAwsVerification(): Promise<AwsVerification> {
    const principal = await input.getPrincipal()
    if (!principal?.sub) return signedOut

    const existingProfileId = await input.resolveProfileId(principal.sub)
    const profileId = existingProfileId ?? await input.provisionProfileId(principal)
    const accountStatus = await input.getProfileAccountStatus(profileId)
    if (!accountStatus || accountStatus === 'suspended' || accountStatus === 'deletion_requested') {
      return signedOut
    }

    // Round H (H3): a device signed out from Settings › Account is refused here, on every page, action and API.
    if (input.checkSession && (await input.checkSession(profileId)).status === 'revoked') {
      return { user: null, sessionRevoked: true }
    }

    return {
      user: {
        id: profileId,
        cognitoSub: principal.sub,
        email: principal.email,
      },
      sessionRevoked: false,
    }
  }

  const getAwsVerification = input.cacheVerifiedUser
    ? input.cacheVerifiedUser(loadAwsVerification)
    : loadAwsVerification

  async function getAwsVerifiedUser(): Promise<AwsVerifiedUser | null> {
    return (await getAwsVerification()).user
  }

  async function requireAwsUser(): Promise<AwsVerifiedUser> {
    const user = await getAwsVerifiedUser()
    if (!user) throw new AwsAuthenticationRequiredError()
    return user
  }

  return { getAwsVerifiedUser, requireAwsUser, getAwsVerification }
}

export async function resolveCognitoPrincipalFromAccessToken(
  api: Pick<ReturnType<typeof createCognitoApi>, 'getUser'>,
  accessToken: string,
): Promise<CognitoPrincipal | null> {
  try {
    const principal = await api.getUser(accessToken)
    return principal.sub ? principal : null
  } catch (error) {
    if (error instanceof CognitoApiError && error.code === 'NotAuthorizedException') {
      return null
    }
    throw error
  }
}

const resolveProductionCognitoPrincipal = createCognitoPrincipalResolver({
  getUser: async (accessToken) => {
    const environment = getCognitoEnvironment()
    const api = createCognitoApi({
      region: environment.AWS_COGNITO_REGION,
      clientId: environment.AWS_COGNITO_CLIENT_ID,
    })
    return api.getUser(accessToken)
  },
})

async function getServerCognitoPrincipal(): Promise<CognitoPrincipal | null> {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get(COGNITO_COOKIE_NAMES.access)?.value
  if (!accessToken) return null

  return resolveProductionCognitoPrincipal(accessToken)
}

const productionQueries = createAwsAuthQueries({
  getPrincipal: getServerCognitoPrincipal,
  resolveProfileId: resolveProfileIdForCognitoSub,
  provisionProfileId: provisionProfileForCognitoPrincipal,
  getProfileAccountStatus,
  cacheVerifiedUser: (loader) => cache(loader),
  checkSession: checkCurrentSession,
})

export const getAwsVerifiedUser = productionQueries.getAwsVerifiedUser
export const requireAwsUser = productionQueries.requireAwsUser
/** Round H (H3): the verified user plus whether this device's session was signed out. */
export const getAwsVerification = productionQueries.getAwsVerification
