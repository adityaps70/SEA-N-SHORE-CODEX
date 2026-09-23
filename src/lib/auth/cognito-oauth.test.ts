import { describe, expect, it, vi } from 'vitest'
import { createCognitoOAuth, verifyOAuthState } from './cognito-oauth'

describe('Cognito Google OAuth with PKCE', () => {
  const config = {
    domain: 'sea-n-shore-staging.auth.ap-south-1.amazoncognito.com',
    clientId: 'client123456789',
    siteUrl: 'https://d3prih0q6jofyr.cloudfront.net',
  }

  it('builds a Google authorize URL with state and S256 PKCE', () => {
    const oauth = createCognitoOAuth(config, {
      randomBytes: () => Buffer.from('01234567890123456789012345678901'),
    })
    const request = oauth.createAuthorizationRequest()

    const url = new URL(request.url)
    expect(url.origin).toBe('https://sea-n-shore-staging.auth.ap-south-1.amazoncognito.com')
    expect(url.pathname).toBe('/oauth2/authorize')
    expect(url.searchParams.get('identity_provider')).toBe('Google')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe(config.clientId)
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://d3prih0q6jofyr.cloudfront.net/auth/google/callback',
    )
    expect(url.searchParams.get('scope')).toBe('openid email profile')
    expect(url.searchParams.get('state')).toBe(request.state)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(request.verifier).not.toBe(request.state)
  })

  it('exchanges an authorization code without requiring a client secret', async () => {
    const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body))
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('client_id')).toBe(config.clientId)
      expect(body.get('client_secret')).toBeNull()
      expect(body.get('code')).toBe('authorization-code')
      expect(body.get('code_verifier')).toBe('pkce-verifier')
      expect(body.get('redirect_uri')).toBe(
        'https://d3prih0q6jofyr.cloudfront.net/auth/google/callback',
      )
      return new Response(JSON.stringify({
        access_token: 'access-token',
        id_token: 'id-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    const oauth = createCognitoOAuth(config, { transport })
    await expect(oauth.exchangeCode({
      code: 'authorization-code',
      verifier: 'pkce-verifier',
    })).resolves.toEqual({
      accessToken: 'access-token',
      idToken: 'id-token',
      refreshToken: 'refresh-token',
      expiresIn: 3600,
    })
  })

  it('compares OAuth state exactly and rejects malformed values', () => {
    expect(verifyOAuthState('state-value', 'state-value')).toBe(true)
    expect(verifyOAuthState('state-value', 'state-value2')).toBe(false)
    expect(verifyOAuthState('', '')).toBe(false)
  })

  it('returns a safe OAuth error without echoing codes or token responses', async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify({
      error: 'invalid_grant',
      error_description: 'authorization-code-is-secret',
    }), { status: 400 }))

    const oauth = createCognitoOAuth(config, { transport })
    await expect(oauth.exchangeCode({
      code: 'authorization-code-is-secret',
      verifier: 'verifier-is-secret',
    })).rejects.toThrow('Cognito OAuth exchange failed.')
  })
})
