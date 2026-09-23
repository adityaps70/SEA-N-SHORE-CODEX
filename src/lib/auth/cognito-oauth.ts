import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto'
import type { CognitoAuthenticationResult } from './cognito-api'

type OAuthConfig = {
  domain: string
  clientId: string
  siteUrl: string
}

type OAuthDependencies = {
  transport?: typeof fetch
  randomBytes?: (size: number) => Buffer
}

function base64Url(value: Buffer) {
  return value.toString('base64url')
}

function normalizedDomain(domain: string) {
  return domain.replace(/^https?:\/\//i, '').replace(/\/+$/g, '')
}

function callbackUrl(siteUrl: string) {
  return `${siteUrl.replace(/\/+$/g, '')}/auth/google/callback`
}

export function verifyOAuthState(expected: string | null | undefined, actual: string | null | undefined) {
  if (!expected || !actual) return false
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)
  if (expectedBuffer.length !== actualBuffer.length) return false
  return timingSafeEqual(expectedBuffer, actualBuffer)
}

export function createCognitoOAuth(
  config: OAuthConfig,
  dependencies: OAuthDependencies = {},
) {
  const transport = dependencies.transport ?? fetch
  const random = dependencies.randomBytes ?? nodeRandomBytes
  const domain = normalizedDomain(config.domain)
  const redirectUri = callbackUrl(config.siteUrl)

  return {
    createAuthorizationRequest() {
      const state = base64Url(random(32))
      const verifier = base64Url(random(48))
      const challenge = createHash('sha256').update(verifier).digest('base64url')
      const url = new URL(`https://${domain}/oauth2/authorize`)
      url.searchParams.set('identity_provider', 'Google')
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', config.clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('scope', 'openid email profile')
      url.searchParams.set('state', state)
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('code_challenge', challenge)

      return {
        url: url.toString(),
        state,
        verifier,
      }
    },

    async exchangeCode(input: {
      code: string
      verifier: string
    }): Promise<CognitoAuthenticationResult> {
      let response: Response
      try {
        response = await transport(`https://${domain}/oauth2/token`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: config.clientId,
            code: input.code,
            redirect_uri: redirectUri,
            code_verifier: input.verifier,
          }).toString(),
        })
      } catch {
        throw new Error('Cognito OAuth exchange failed.')
      }

      let payload: {
        access_token?: unknown
        id_token?: unknown
        refresh_token?: unknown
        expires_in?: unknown
      } = {}
      try {
        payload = await response.json()
      } catch {
        throw new Error('Cognito OAuth exchange failed.')
      }

      if (
        !response.ok
        || typeof payload.access_token !== 'string'
        || typeof payload.expires_in !== 'number'
      ) {
        throw new Error('Cognito OAuth exchange failed.')
      }

      return {
        accessToken: payload.access_token,
        ...(typeof payload.id_token === 'string' ? { idToken: payload.id_token } : {}),
        ...(typeof payload.refresh_token === 'string'
          ? { refreshToken: payload.refresh_token }
          : {}),
        expiresIn: payload.expires_in,
      }
    },
  }
}
