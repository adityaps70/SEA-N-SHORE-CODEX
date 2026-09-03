import { describe, expect, it, vi } from 'vitest'
import { CognitoApiError, createCognitoApi } from './cognito-api'

const config = {
  region: 'ap-south-1',
  clientId: '3drntpmdlu2bq6dafi3pqho5a5',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/x-amz-json-1.1' },
  })
}

function requestBody(init?: RequestInit) {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
}

describe('createCognitoApi', () => {
  it('maps AuthenticationResult without exposing the raw Cognito response shape', async () => {
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://cognito-idp.ap-south-1.amazonaws.com/')
      expect(new Headers(init?.headers).get('x-amz-target')).toBe(
        'AWSCognitoIdentityProviderService.InitiateAuth',
      )
      expect(requestBody(init)).toEqual({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: config.clientId,
        AuthParameters: {
          USERNAME: 'captain@example.com',
          PASSWORD: 'ExamplePassword123',
        },
      })

      return jsonResponse({
        AuthenticationResult: {
          AccessToken: 'access-token',
          IdToken: 'id-token',
          RefreshToken: 'refresh-token',
          ExpiresIn: 3600,
          TokenType: 'Bearer',
        },
        ResponseMetadata: { RequestId: 'internal-request-id' },
      })
    })

    const api = createCognitoApi(config, transport)
    const result = await api.signIn({
      username: 'captain@example.com',
      password: 'ExamplePassword123',
    })

    expect(result).toEqual({
      kind: 'authenticated',
      authentication: {
        accessToken: 'access-token',
        idToken: 'id-token',
        refreshToken: 'refresh-token',
        expiresIn: 3600,
      },
    })
    expect(result).not.toHaveProperty('ResponseMetadata')
  })

  it('maps NEW_PASSWORD_REQUIRED and preserves the opaque Cognito session', async () => {
    const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('x-amz-target')).toBe(
        'AWSCognitoIdentityProviderService.InitiateAuth',
      )

      return jsonResponse({
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        Session: 'opaque-challenge-session',
        ChallengeParameters: {
          USER_ID_FOR_SRP: 'captain@example.com',
        },
      })
    })

    const api = createCognitoApi(config, transport)
    const result = await api.signIn({
      username: 'captain@example.com',
      password: 'TemporaryPassword123',
    })

    expect(result).toEqual({
      kind: 'new-password-required',
      session: 'opaque-challenge-session',
      username: 'captain@example.com',
    })
  })

  it('maps GetUser attributes to sub, email and emailVerified', async () => {
    const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('x-amz-target')).toBe(
        'AWSCognitoIdentityProviderService.GetUser',
      )
      expect(requestBody(init)).toEqual({ AccessToken: 'access-token' })

      return jsonResponse({
        Username: 'internal-cognito-username',
        UserAttributes: [
          { Name: 'sub', Value: 'cognito-sub-123' },
          { Name: 'email', Value: 'captain@example.com' },
          { Name: 'email_verified', Value: 'true' },
        ],
      })
    })

    const api = createCognitoApi(config, transport)

    await expect(api.getUser('access-token')).resolves.toEqual({
      sub: 'cognito-sub-123',
      email: 'captain@example.com',
      emailVerified: true,
    })
  })

  it('refreshes authentication using REFRESH_TOKEN_AUTH', async () => {
    const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('x-amz-target')).toBe(
        'AWSCognitoIdentityProviderService.InitiateAuth',
      )
      expect(requestBody(init)).toEqual({
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: config.clientId,
        AuthParameters: { REFRESH_TOKEN: 'refresh-token' },
      })
      return jsonResponse({
        AuthenticationResult: {
          AccessToken: 'new-access-token',
          IdToken: 'new-id-token',
          ExpiresIn: 3600,
        },
      })
    })

    const api = createCognitoApi(config, transport)
    await expect(api.refresh('refresh-token')).resolves.toEqual({
      accessToken: 'new-access-token',
      idToken: 'new-id-token',
      expiresIn: 3600,
    })
  })

  it('completes NEW_PASSWORD_REQUIRED using RespondToAuthChallenge', async () => {
    const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('x-amz-target')).toBe(
        'AWSCognitoIdentityProviderService.RespondToAuthChallenge',
      )
      expect(requestBody(init)).toEqual({
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        ClientId: config.clientId,
        Session: 'opaque-session',
        ChallengeResponses: {
          USERNAME: 'captain@example.com',
          NEW_PASSWORD: 'NewPassword12345',
        },
      })
      return jsonResponse({
        AuthenticationResult: {
          AccessToken: 'access-token',
          IdToken: 'id-token',
          RefreshToken: 'refresh-token',
          ExpiresIn: 3600,
        },
      })
    })

    const api = createCognitoApi(config, transport)
    await expect(
      api.respondToNewPassword({
        username: 'captain@example.com',
        newPassword: 'NewPassword12345',
        session: 'opaque-session',
      }),
    ).resolves.toEqual({
      accessToken: 'access-token',
      idToken: 'id-token',
      refreshToken: 'refresh-token',
      expiresIn: 3600,
    })
  })

  it('supports sign-up and confirmation', async () => {
    const operations: string[] = []
    const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const target = new Headers(init?.headers).get('x-amz-target') ?? ''
      operations.push(target)
      if (target.endsWith('.SignUp')) {
        expect(requestBody(init)).toEqual({
          ClientId: config.clientId,
          Username: 'new@example.com',
          Password: 'ExamplePassword123',
          UserAttributes: [
            { Name: 'email', Value: 'new@example.com' },
            { Name: 'name', Value: 'New Mariner' },
          ],
        })
        return jsonResponse({ UserSub: 'new-sub', UserConfirmed: false })
      }
      expect(requestBody(init)).toEqual({
        ClientId: config.clientId,
        Username: 'new@example.com',
        ConfirmationCode: '123456',
      })
      return jsonResponse({})
    })

    const api = createCognitoApi(config, transport)
    await expect(
      api.signUp({
        username: 'new@example.com',
        password: 'ExamplePassword123',
        fullName: 'New Mariner',
      }),
    ).resolves.toEqual({ userSub: 'new-sub', userConfirmed: false })
    await expect(
      api.confirmSignUp({ username: 'new@example.com', code: '123456' }),
    ).resolves.toBeUndefined()
    expect(operations).toEqual([
      'AWSCognitoIdentityProviderService.SignUp',
      'AWSCognitoIdentityProviderService.ConfirmSignUp',
    ])
  })

  it('supports forgot-password and confirm-forgot-password', async () => {
    const operations: string[] = []
    const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const target = new Headers(init?.headers).get('x-amz-target') ?? ''
      operations.push(target)
      if (target.endsWith('.ForgotPassword')) {
        expect(requestBody(init)).toEqual({
          ClientId: config.clientId,
          Username: 'captain@example.com',
        })
      } else {
        expect(requestBody(init)).toEqual({
          ClientId: config.clientId,
          Username: 'captain@example.com',
          ConfirmationCode: '654321',
          Password: 'ResetPassword12345',
        })
      }
      return jsonResponse({})
    })

    const api = createCognitoApi(config, transport)
    await expect(api.forgotPassword('captain@example.com')).resolves.toBeUndefined()
    await expect(
      api.confirmForgotPassword({
        username: 'captain@example.com',
        code: '654321',
        newPassword: 'ResetPassword12345',
      }),
    ).resolves.toBeUndefined()
    expect(operations).toEqual([
      'AWSCognitoIdentityProviderService.ForgotPassword',
      'AWSCognitoIdentityProviderService.ConfirmForgotPassword',
    ])
  })

  it('globally signs out an access token', async () => {
    const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('x-amz-target')).toBe(
        'AWSCognitoIdentityProviderService.GlobalSignOut',
      )
      expect(requestBody(init)).toEqual({ AccessToken: 'access-token' })
      return jsonResponse({})
    })

    const api = createCognitoApi(config, transport)
    await expect(api.globalSignOut('access-token')).resolves.toBeUndefined()
  })

  it('throws CognitoApiError containing only the AWS error code and a safe message', async () => {
    const transport = vi.fn(async () =>
      jsonResponse(
        {
          __type: 'NotAuthorizedException',
          message: 'Incorrect username or password.',
        },
        400,
      ),
    )

    const api = createCognitoApi(config, transport)

    await expect(
      api.signIn({ username: 'captain@example.com', password: 'WrongPassword123' }),
    ).rejects.toMatchObject<CognitoApiError>({
      name: 'CognitoApiError',
      code: 'NotAuthorizedException',
      message: 'Cognito request was not authorized.',
    })
  })

  it('never includes password, access token, refresh token or challenge session values in thrown errors', async () => {
    const password = 'SuperSecretPassword123'
    const accessToken = 'very-secret-access-token'
    const refreshToken = 'very-secret-refresh-token'
    const session = 'very-secret-challenge-session'

    const transport = vi.fn(async () => {
      throw new Error(`transport failed ${password} ${accessToken} ${refreshToken} ${session}`)
    })

    const api = createCognitoApi(config, transport)

    let thrown: unknown
    try {
      await api.signIn({ username: 'captain@example.com', password })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(CognitoApiError)
    const message = String(thrown)
    expect(message).not.toContain(password)
    expect(message).not.toContain(accessToken)
    expect(message).not.toContain(refreshToken)
    expect(message).not.toContain(session)
  })
})
