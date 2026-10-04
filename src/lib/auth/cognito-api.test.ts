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

  it('maps GetUser attributes to the stable subject plus verified email/phone identifiers', async () => {
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
          { Name: 'name', Value: 'Captain Example' },
          { Name: 'phone_number', Value: '+919876543210' },
          { Name: 'phone_number_verified', Value: 'true' },
        ],
      })
    })

    const api = createCognitoApi(config, transport)

    await expect(api.getUser('access-token')).resolves.toEqual({
      sub: 'cognito-sub-123',
      username: 'internal-cognito-username',
      email: 'captain@example.com',
      emailVerified: true,
      phoneNumber: '+919876543210',
      phoneNumberVerified: true,
      name: 'Captain Example',
    })
  })

  it('starts and answers a custom authentication challenge without exposing the OTP', async () => {
    const operations: string[] = []
    const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const target = new Headers(init?.headers).get('x-amz-target') ?? ''
      operations.push(target)
      const body = requestBody(init)

      if (operations.length === 1) {
        expect(body).toEqual({
          AuthFlow: 'CUSTOM_AUTH',
          ClientId: config.clientId,
          AuthParameters: { USERNAME: 'phone-user@example.com' },
        })
        return jsonResponse({
          ChallengeName: 'CUSTOM_CHALLENGE',
          Session: 'phone-challenge-session',
          ChallengeParameters: { USERNAME: 'phone-user@example.com' },
        })
      }

      expect(body).toEqual({
        ChallengeName: 'CUSTOM_CHALLENGE',
        ClientId: config.clientId,
        Session: 'phone-challenge-session',
        ChallengeResponses: {
          USERNAME: 'phone-user@example.com',
          ANSWER: '123456',
        },
      })
      return jsonResponse({
        AuthenticationResult: {
          AccessToken: 'phone-access-token',
          IdToken: 'phone-id-token',
          RefreshToken: 'phone-refresh-token',
          ExpiresIn: 3600,
        },
      })
    })

    const api = createCognitoApi(config, transport)
    await expect(api.startCustomAuth('phone-user@example.com')).resolves.toEqual({
      kind: 'challenge',
      session: 'phone-challenge-session',
      username: 'phone-user@example.com',
    })
    await expect(api.respondToCustomChallenge({
      username: 'phone-user@example.com',
      session: 'phone-challenge-session',
      answer: '123456',
    })).resolves.toEqual({
      kind: 'authenticated',
      authentication: {
        accessToken: 'phone-access-token',
        idToken: 'phone-id-token',
        refreshToken: 'phone-refresh-token',
        expiresIn: 3600,
      },
    })
    expect(operations).toEqual([
      'AWSCognitoIdentityProviderService.InitiateAuth',
      'AWSCognitoIdentityProviderService.RespondToAuthChallenge',
    ])
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

  it('deletes the authenticated Cognito user with the freshly re-authenticated access token', async () => {
    const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('x-amz-target')).toBe(
        'AWSCognitoIdentityProviderService.DeleteUser',
      )
      expect(requestBody(init)).toEqual({ AccessToken: 'fresh-access-token' })
      return jsonResponse({})
    })

    const api = createCognitoApi(config, transport)
    await expect(api.deleteUser('fresh-access-token')).resolves.toBeUndefined()
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
    ).rejects.toMatchObject({
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
describe('Cognito authenticator-app MFA (Round 14, 2.11)', () => {
  function recordingTransport(responses: Record<string, unknown>) {
    const calls: Array<{ operation: string; body: Record<string, unknown> }> = []
    const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const operation = (new Headers(init?.headers).get('x-amz-target') ?? '').replace('AWSCognitoIdentityProviderService.', '')
      calls.push({ operation, body: requestBody(init) })
      const response = responses[operation]
      if (response instanceof Response) return response
      return jsonResponse(response ?? {})
    })
    return { calls, transport }
  }

  it('maps SOFTWARE_TOKEN_MFA after a correct password to a code step that keeps the opaque session', async () => {
    const { transport } = recordingTransport({
      InitiateAuth: {
        ChallengeName: 'SOFTWARE_TOKEN_MFA',
        Session: 'opaque-mfa-session',
        ChallengeParameters: { USER_ID_FOR_SRP: 'internal-user-1' },
      },
    })

    await expect(createCognitoApi(config, transport).signIn({
      username: 'captain@example.com',
      password: 'ExamplePassword123',
    })).resolves.toEqual({
      kind: 'software-token-mfa',
      session: 'opaque-mfa-session',
      username: 'internal-user-1',
    })
  })

  it('falls back to the typed sign-in email when Cognito sends no challenge username', async () => {
    const { transport } = recordingTransport({
      InitiateAuth: { ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 'opaque-mfa-session', ChallengeParameters: {} },
    })

    await expect(createCognitoApi(config, transport).signIn({
      username: 'captain@example.com',
      password: 'ExamplePassword123',
    })).resolves.toMatchObject({ kind: 'software-token-mfa', username: 'captain@example.com' })
  })

  it('still refuses challenges it does not handle, and an MFA challenge without a session', async () => {
    for (const response of [
      { ChallengeName: 'SMS_MFA', Session: 's1', ChallengeParameters: {} },
      { ChallengeName: 'SELECT_MFA_TYPE', Session: 's1', ChallengeParameters: {} },
      { ChallengeName: 'MFA_SETUP', Session: 's1', ChallengeParameters: {} },
      { ChallengeName: 'SOFTWARE_TOKEN_MFA', ChallengeParameters: {} },
    ]) {
      const { transport } = recordingTransport({ InitiateAuth: response })
      await expect(createCognitoApi(config, transport).signIn({
        username: 'captain@example.com',
        password: 'ExamplePassword123',
      })).rejects.toMatchObject({ code: 'UnexpectedResponse' })
    }
  })

  it('answers SOFTWARE_TOKEN_MFA with the session and code and returns only the tokens', async () => {
    const { calls, transport } = recordingTransport({
      RespondToAuthChallenge: {
        AuthenticationResult: { AccessToken: 'access-2', RefreshToken: 'refresh-2', ExpiresIn: 3600 },
        ResponseMetadata: { RequestId: 'internal' },
      },
    })

    await expect(createCognitoApi(config, transport).respondToSoftwareTokenMfa({
      username: 'internal-user-1',
      session: 'opaque-mfa-session',
      code: '123456',
    })).resolves.toEqual({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 3600 })
    expect(calls).toEqual([{
      operation: 'RespondToAuthChallenge',
      body: {
        ChallengeName: 'SOFTWARE_TOKEN_MFA',
        ClientId: config.clientId,
        Session: 'opaque-mfa-session',
        ChallengeResponses: { USERNAME: 'internal-user-1', SOFTWARE_TOKEN_MFA_CODE: '123456' },
      },
    }])
  })

  it('surfaces a wrong code as CodeMismatchException without echoing the code', async () => {
    const { transport } = recordingTransport({
      RespondToAuthChallenge: jsonResponse({ __type: 'CodeMismatchException', message: 'Invalid code received for user' }, 400),
    })

    const error = await createCognitoApi(config, transport).respondToSoftwareTokenMfa({
      username: 'u', session: 's', code: '654321',
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CognitoApiError)
    expect(error).toMatchObject({ code: 'CodeMismatchException' })
    expect(String((error as Error).message)).not.toContain('654321')
  })

  it('reads authenticator status from GetUser with the access token', async () => {
    const { calls, transport } = recordingTransport({
      GetUser: {
        Username: 'internal-user-1',
        UserAttributes: [{ Name: 'email', Value: 'captain@example.com' }],
        UserMFASettingList: ['SOFTWARE_TOKEN_MFA'],
        PreferredMfaSetting: 'SOFTWARE_TOKEN_MFA',
      },
    })
    const api = createCognitoApi(config, transport)

    await expect(api.getUserMfaSettings('access-token')).resolves.toEqual({
      username: 'internal-user-1',
      email: 'captain@example.com',
      softwareTokenEnabled: true,
      preferredMfa: 'SOFTWARE_TOKEN_MFA',
    })
    expect(calls[0]).toEqual({ operation: 'GetUser', body: { AccessToken: 'access-token' } })
  })

  it('reports authenticator MFA off when Cognito lists no software token', async () => {
    const { transport } = recordingTransport({ GetUser: { Username: 'u', UserAttributes: [] } })
    await expect(createCognitoApi(config, transport).getUserMfaSettings('access-token')).resolves.toEqual({
      username: 'u',
      email: null,
      softwareTokenEnabled: false,
      preferredMfa: null,
    })
  })

  it('associates, verifies and sets the authenticator preference with the member access token', async () => {
    const { calls, transport } = recordingTransport({
      AssociateSoftwareToken: { SecretCode: 'JBSWY3DPEHPK3PXP' },
      VerifySoftwareToken: { Status: 'SUCCESS' },
      SetUserMFAPreference: {},
    })
    const api = createCognitoApi(config, transport)

    await expect(api.associateSoftwareToken('access-token')).resolves.toEqual({ secretCode: 'JBSWY3DPEHPK3PXP' })
    await expect(api.verifySoftwareToken({ accessToken: 'access-token', code: '123456', friendlyDeviceName: 'Authenticator app' }))
      .resolves.toEqual({ status: 'SUCCESS' })
    await api.setSoftwareTokenMfaPreference({ accessToken: 'access-token', enabled: true })
    await api.setSoftwareTokenMfaPreference({ accessToken: 'access-token', enabled: false })

    expect(calls).toEqual([
      { operation: 'AssociateSoftwareToken', body: { AccessToken: 'access-token' } },
      { operation: 'VerifySoftwareToken', body: { AccessToken: 'access-token', UserCode: '123456', FriendlyDeviceName: 'Authenticator app' } },
      { operation: 'SetUserMFAPreference', body: { AccessToken: 'access-token', SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true } } },
      { operation: 'SetUserMFAPreference', body: { AccessToken: 'access-token', SoftwareTokenMfaSettings: { Enabled: false, PreferredMfa: false } } },
    ])
  })

  it('treats a missing secret or a non-SUCCESS verification as failure', async () => {
    const { transport } = recordingTransport({ AssociateSoftwareToken: {}, VerifySoftwareToken: { Status: 'ERROR' } })
    const api = createCognitoApi(config, transport)

    await expect(api.associateSoftwareToken('access-token')).rejects.toMatchObject({ code: 'UnexpectedResponse' })
    await expect(api.verifySoftwareToken({ accessToken: 'access-token', code: '123456' })).resolves.toEqual({ status: 'ERROR' })
  })
})
