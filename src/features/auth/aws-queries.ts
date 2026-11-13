import { cookies } from 'next/headers'
import { cache } from 'react'
import { inActionScope, scoped } from '@/lib/server/action-scope'
import { CognitoApiError, createCognitoApi, type CognitoPrincipal } from '@/lib/auth/cognito-api'
import { COGNITO_COOKIE_NAMES } from '@/lib/auth/cognito-cookies'
import { createCognitoPrincipalResolver } from '@/lib/auth/cognito-principal-cache'
import { getCognitoEnvironment } from '@/lib/env'
import { checkCurrentSession } from '@/features/account-security/session-runtime'
import type { SessionEndReason } from '@/features/account-security/session-guard'
import {
  getProfileAccountStatus,
  provisionProfileForCognitoPrincipal,
  resolveProfileIdForCognitoSub,
  resolveProfileWithStatusForCognitoSub,
} from './identity-repository'

export type AwsVerifiedUser = {
  id: string
  cognitoSub: string
  email: string | null
}

type GetPrincipal = () => Promise<CognitoPrincipal | null>
type ResolveProfileId = (sub: string) => Promise<string | null>
type ProvisionProfileId = (principal: CognitoPrincipal) => Promise<string>
type AccountStatus = 'active' | 'restricted' | 'suspended' | 'deletion_requested'
type GetProfileAccountStatus = (profileId: string) => Promise<AccountStatus | null>
/** Round DB: the mapping and the account status in one query; null when there is no mapping yet. */
type ResolveProfileWithStatus = (sub: string) => Promise<{ profileId: string; accountStatus: AccountStatus | null } | null>
type CacheVerifiedUser = <T>(loader: () => Promise<T>) => () => Promise<T>
/** Round H (H3): this device's session state (see features/account-security/session-guard). */
type CheckSession = (profileId: string) => Promise<
  { status: 'active' | 'untracked' } | { status: 'revoked'; reason?: SessionEndReason }
>

export type AwsVerification = {
  user: AwsVerifiedUser | null
  /** True when the Cognito tokens are valid but this device was signed out (Settings › Account). */
  sessionRevoked: boolean
  /** Round I (I3): why, when sessionRevoked: signed out, not used for 30 days, or an old refresh token was reused. */
  sessionEndReason?: SessionEndReason
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
  resolveProfileWithStatus?: ResolveProfileWithStatus
  cacheVerifiedUser?: CacheVerifiedUser
  checkSession?: CheckSession
}) {
  const signedOut: AwsVerification = { user: null, sessionRevoked: false }

  async function loadAwsVerification(): Promise<AwsVerification> {
    const principal = await input.getPrincipal()
    if (!principal?.sub) return signedOut

    let profileId: string
    let accountStatus: AccountStatus | null
    const existing = input.resolveProfileWithStatus ? await input.resolveProfileWithStatus(principal.sub) : null
    if (existing) {
      profileId = existing.profileId
      accountStatus = existing.accountStatus
    } else {
      // No mapping yet (first sign-in), or a caller without the one-query lookup: the original two steps.
      const existingProfileId = input.resolveProfileWithStatus ? null : await input.resolveProfileId(principal.sub)
      profileId = existingProfileId ?? await input.provisionProfileId(principal)
      accountStatus = await input.getProfileAccountStatus(profileId)
    }
    if (!accountStatus || accountStatus === 'suspended' || accountStatus === 'deletion_requested') {
      return signedOut
    }

    // Round H (H3): a device signed out from Settings › Account is refused here, on every page, action and API.
    const session = input.checkSession ? await input.checkSession(profileId) : null
    if (session?.status === 'revoked') {
      return { user: null, sessionRevoked: true, sessionEndReason: session.reason ?? 'signed_out' }
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

/** A render memoises with React cache(); a Server Action body inside actionScope() memoises per call (Round CAP). */
export function actionAwareVerificationCache<T>(loader: () => Promise<T>): () => Promise<T> {
  const rendered = cache(loader)
  return () => (inActionScope() ? scoped('auth:aws-verification', loader) : rendered())
}

const productionQueries = createAwsAuthQueries({
  getPrincipal: getServerCognitoPrincipal,
  resolveProfileId: resolveProfileIdForCognitoSub,
  provisionProfileId: provisionProfileForCognitoPrincipal,
  getProfileAccountStatus,
  resolveProfileWithStatus: resolveProfileWithStatusForCognitoSub,
  cacheVerifiedUser: actionAwareVerificationCache,
  checkSession: checkCurrentSession,
})

export const getAwsVerifiedUser = productionQueries.getAwsVerifiedUser
export const requireAwsUser = productionQueries.requireAwsUser
/** Round H (H3): the verified user plus whether this device's session was signed out. */
export const getAwsVerification = productionQueries.getAwsVerification
