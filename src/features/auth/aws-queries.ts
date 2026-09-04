import { cookies } from 'next/headers'
import { cache } from 'react'
import type { CognitoPrincipal } from '@/lib/auth/cognito-api'
import { createCognitoApi } from '@/lib/auth/cognito-api'
import { COGNITO_COOKIE_NAMES } from '@/lib/auth/cognito-cookies'
import { getCognitoEnvironment } from '@/lib/env'
import { resolveProfileIdForCognitoSub } from './identity-repository'

export type AwsVerifiedUser = {
  id: string
  cognitoSub: string
  email: string | null
}

type GetPrincipal = () => Promise<CognitoPrincipal | null>
type ResolveProfileId = (sub: string) => Promise<string | null>

export class AwsAuthenticationRequiredError extends Error {
  constructor() {
    super('Authentication required.')
    this.name = 'AwsAuthenticationRequiredError'
  }
}

export function createAwsAuthQueries(input: {
  getPrincipal: GetPrincipal
  resolveProfileId: ResolveProfileId
}) {
  async function getAwsVerifiedUser(): Promise<AwsVerifiedUser | null> {
    const principal = await input.getPrincipal()
    if (!principal?.sub) return null

    const profileId = await input.resolveProfileId(principal.sub)
    if (!profileId) return null

    return {
      id: profileId,
      cognitoSub: principal.sub,
      email: principal.email,
    }
  }

  async function requireAwsUser(): Promise<AwsVerifiedUser> {
    const user = await getAwsVerifiedUser()
    if (!user) throw new AwsAuthenticationRequiredError()
    return user
  }

  return { getAwsVerifiedUser, requireAwsUser }
}

async function getServerCognitoPrincipal(): Promise<CognitoPrincipal | null> {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get(COGNITO_COOKIE_NAMES.access)?.value
  if (!accessToken) return null

  const environment = getCognitoEnvironment()
  const api = createCognitoApi({
    region: environment.AWS_COGNITO_REGION,
    clientId: environment.AWS_COGNITO_CLIENT_ID,
  })

  try {
    const principal = await api.getUser(accessToken)
    return principal.sub ? principal : null
  } catch {
    return null
  }
}

const productionQueries = createAwsAuthQueries({
  getPrincipal: getServerCognitoPrincipal,
  resolveProfileId: resolveProfileIdForCognitoSub,
})

export const getAwsVerifiedUser = cache(productionQueries.getAwsVerifiedUser)
export const requireAwsUser = productionQueries.requireAwsUser
