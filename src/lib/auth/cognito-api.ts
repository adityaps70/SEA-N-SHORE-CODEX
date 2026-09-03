export type CognitoAuthenticationResult = {
  accessToken: string
  idToken?: string
  refreshToken?: string
  expiresIn: number
}

export type CognitoSignInResult =
  | { kind: 'authenticated'; authentication: CognitoAuthenticationResult }
  | { kind: 'new-password-required'; session: string; username: string }

export type CognitoPrincipal = {
  sub: string
  email: string | null
  emailVerified: boolean
}

export type CognitoSignUpResult = {
  userSub: string
  userConfirmed: boolean
}

type CognitoConfig = {
  region: string
  clientId: string
}

type Transport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type CognitoAuthenticationResponse = {
  AuthenticationResult?: {
    AccessToken?: string
    IdToken?: string
    RefreshToken?: string
    ExpiresIn?: number
  }
  ChallengeName?: string
  Session?: string
  ChallengeParameters?: Record<string, string>
}

type CognitoGetUserResponse = {
  UserAttributes?: Array<{ Name?: string; Value?: string }>
}

type CognitoSignUpResponse = {
  UserSub?: string
  UserConfirmed?: boolean
}

const SAFE_ERROR_MESSAGES: Record<string, string> = {
  NotAuthorizedException: 'Cognito request was not authorized.',
  UserNotFoundException: 'Cognito user was not found.',
  UsernameExistsException: 'A Cognito user with this identity already exists.',
  InvalidPasswordException: 'The password does not meet Cognito requirements.',
  CodeMismatchException: 'The confirmation code is invalid.',
  ExpiredCodeException: 'The confirmation code has expired.',
  LimitExceededException: 'Cognito request limit exceeded. Please try again later.',
  TooManyRequestsException: 'Too many Cognito requests. Please try again later.',
}

function normalizeErrorCode(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) return 'CognitoRequestError'
  return value.includes('#') ? value.slice(value.lastIndexOf('#') + 1) : value
}

function safeMessageFor(code: string) {
  return SAFE_ERROR_MESSAGES[code] ?? 'Cognito request failed.'
}

export class CognitoApiError extends Error {
  readonly code: string

  constructor(code: string, message = safeMessageFor(code)) {
    super(message)
    this.name = 'CognitoApiError'
    this.code = code
  }
}

function mapAuthenticationTokens(response: CognitoAuthenticationResponse): CognitoAuthenticationResult {
  const authentication = response.AuthenticationResult
  if (!authentication?.AccessToken || typeof authentication.ExpiresIn !== 'number') {
    throw new CognitoApiError('UnexpectedResponse')
  }

  return {
    accessToken: authentication.AccessToken,
    ...(authentication.IdToken ? { idToken: authentication.IdToken } : {}),
    ...(authentication.RefreshToken ? { refreshToken: authentication.RefreshToken } : {}),
    expiresIn: authentication.ExpiresIn,
  }
}

function mapSignInResult(response: CognitoAuthenticationResponse): CognitoSignInResult {
  if (response.AuthenticationResult) {
    return {
      kind: 'authenticated',
      authentication: mapAuthenticationTokens(response),
    }
  }

  if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED' && response.Session) {
    const username = response.ChallengeParameters?.USER_ID_FOR_SRP
    if (username) {
      return {
        kind: 'new-password-required',
        session: response.Session,
        username,
      }
    }
  }

  throw new CognitoApiError('UnexpectedResponse')
}

export function createCognitoApi(config: CognitoConfig, transport: Transport = fetch) {
  const endpoint = `https://cognito-idp.${config.region}.amazonaws.com/`

  async function request<T>(operation: string, body: Record<string, unknown>): Promise<T> {
    let response: Response
    try {
      response = await transport(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': `AWSCognitoIdentityProviderService.${operation}`,
        },
        body: JSON.stringify(body),
      })
    } catch {
      throw new CognitoApiError('TransportError')
    }

    let payload: unknown = {}
    try {
      payload = await response.json()
    } catch {
      if (!response.ok) throw new CognitoApiError('CognitoRequestError')
    }

    if (!response.ok) {
      const error = payload as { __type?: unknown; code?: unknown }
      const code = normalizeErrorCode(error.__type ?? error.code)
      throw new CognitoApiError(code)
    }

    return payload as T
  }

  return {
    async signIn(input: { username: string; password: string }): Promise<CognitoSignInResult> {
      const response = await request<CognitoAuthenticationResponse>('InitiateAuth', {
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: config.clientId,
        AuthParameters: {
          USERNAME: input.username,
          PASSWORD: input.password,
        },
      })

      return mapSignInResult(response)
    },

    async respondToNewPassword(input: {
      username: string
      newPassword: string
      session: string
    }): Promise<CognitoAuthenticationResult> {
      const response = await request<CognitoAuthenticationResponse>('RespondToAuthChallenge', {
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        ClientId: config.clientId,
        Session: input.session,
        ChallengeResponses: {
          USERNAME: input.username,
          NEW_PASSWORD: input.newPassword,
        },
      })

      return mapAuthenticationTokens(response)
    },

    async refresh(refreshToken: string): Promise<CognitoAuthenticationResult> {
      const response = await request<CognitoAuthenticationResponse>('InitiateAuth', {
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: config.clientId,
        AuthParameters: {
          REFRESH_TOKEN: refreshToken,
        },
      })

      return mapAuthenticationTokens(response)
    },

    async getUser(accessToken: string): Promise<CognitoPrincipal> {
      const response = await request<CognitoGetUserResponse>('GetUser', {
        AccessToken: accessToken,
      })
      const attributes = new Map(
        (response.UserAttributes ?? [])
          .filter((attribute): attribute is { Name: string; Value?: string } => Boolean(attribute.Name))
          .map((attribute) => [attribute.Name, attribute.Value]),
      )

      return {
        sub: attributes.get('sub') ?? '',
        email: attributes.get('email') ?? null,
        emailVerified: attributes.get('email_verified') === 'true',
      }
    },

    async signUp(input: {
      username: string
      password: string
      fullName: string
    }): Promise<CognitoSignUpResult> {
      const response = await request<CognitoSignUpResponse>('SignUp', {
        ClientId: config.clientId,
        Username: input.username,
        Password: input.password,
        UserAttributes: [
          { Name: 'email', Value: input.username },
          { Name: 'name', Value: input.fullName },
        ],
      })

      if (!response.UserSub) throw new CognitoApiError('UnexpectedResponse')

      return {
        userSub: response.UserSub,
        userConfirmed: response.UserConfirmed === true,
      }
    },

    async confirmSignUp(input: { username: string; code: string }): Promise<void> {
      await request('ConfirmSignUp', {
        ClientId: config.clientId,
        Username: input.username,
        ConfirmationCode: input.code,
      })
    },

    async forgotPassword(username: string): Promise<void> {
      await request('ForgotPassword', {
        ClientId: config.clientId,
        Username: username,
      })
    },

    async confirmForgotPassword(input: {
      username: string
      code: string
      newPassword: string
    }): Promise<void> {
      await request('ConfirmForgotPassword', {
        ClientId: config.clientId,
        Username: input.username,
        ConfirmationCode: input.code,
        Password: input.newPassword,
      })
    },

    async globalSignOut(accessToken: string): Promise<void> {
      await request('GlobalSignOut', {
        AccessToken: accessToken,
      })
    },
  }
}
