export type CognitoAuthenticationResult = {
  accessToken: string
  idToken?: string
  refreshToken?: string
  expiresIn: number
}

export type CognitoSignInResult =
  | { kind: 'authenticated'; authentication: CognitoAuthenticationResult }
  | { kind: 'new-password-required'; session: string; username: string }
  | { kind: 'software-token-mfa'; session: string; username: string }

export type CognitoPrincipal = {
  sub: string
  username?: string | null
  email: string | null
  emailVerified: boolean
  phoneNumber?: string | null
  phoneNumberVerified?: boolean
  name: string | null
}

/** Round 14 (2.11): a member's own authenticator-app (TOTP) settings, read with their access token. */
export type CognitoUserMfaSettings = {
  username: string | null
  email: string | null
  /** True when an authenticator app is verified and turned on for sign-in. */
  softwareTokenEnabled: boolean
  preferredMfa: string | null
}

export type CognitoSoftwareTokenVerification = { status: 'SUCCESS' | 'ERROR' }

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
  Username?: string
  UserAttributes?: Array<{ Name?: string; Value?: string }>
  UserMFASettingList?: string[]
  PreferredMfaSetting?: string
}

type CognitoAssociateSoftwareTokenResponse = {
  SecretCode?: string
}

type CognitoVerifySoftwareTokenResponse = {
  Status?: string
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
  EnableSoftwareTokenMFAException: 'The authenticator code is invalid.',
  SoftwareTokenMFANotFoundException: 'No authenticator app is set up for this user.',
  AliasExistsException: 'Another account already uses this value.',
  CodeDeliveryFailureException: 'The verification code could not be delivered.',
  InvalidParameterException: 'Cognito rejected a parameter.',
  UnsupportedTokenTypeException: 'This token cannot be revoked.',
  UnsupportedOperationException: 'This Cognito operation is not enabled.',
}

/** Errors meaning "this endpoint does not know GetTokensFromRefreshToken", never "this token is not valid". */
const REFRESH_FALLBACK_CODES = new Set(['UnknownOperationException', 'UnsupportedOperationException', 'InvalidAction'])

function normalizeErrorCode(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) return 'CognitoRequestError'
  return value.includes('#') ? value.slice(value.lastIndexOf('#') + 1) : value
}

function safeMessageFor(code: string) {
  return SAFE_ERROR_MESSAGES[code] ?? 'Cognito request failed.'
}

export class CognitoApiError extends Error {
  readonly code: string
  /** For a refusal from our own auth Lambdas, its reason code (e.g. "otp_cooldown"), else null. */
  readonly reason: string | null

  constructor(code: string, message = safeMessageFor(code), reason: string | null = null) {
    super(message)
    this.name = 'CognitoApiError'
    this.code = code
    this.reason = reason
  }
}

/** Only our own reason codes are kept from a Lambda refusal, never free text. */
function lambdaRefusalReason(code: string, message: unknown) {
  if (code !== 'UserLambdaValidationException' || typeof message !== 'string') return null
  return /\b(otp_[a-z_]{2,40})\b/.exec(message)?.[1] ?? null
}

/**
 * Round H (H3): for NotAuthorizedException, 'token' when Cognito refused the access token itself (expired, revoked
 * or invalid) rather than a password, so "your current password is wrong" is never shown for an expired session.
 * The raw message is never kept.
 */
export function notAuthorizedReason(code: string, message: unknown) {
  if (code !== 'NotAuthorizedException' || typeof message !== 'string') return null
  return /access token|token has been revoked|token has expired|invalid token/i.test(message) ? 'token' : null
}

/**
 * For InvalidPasswordException, which policy rule Cognito named ("Password must have uppercase
 * characters", "Password not long enough", …) as a short code; the raw message is never kept.
 */
export function passwordRuleReason(code: string, message: unknown) {
  if (code !== 'InvalidPasswordException' || typeof message !== 'string') return null
  if (/long enough|minimum length/i.test(message)) return 'length'
  if (/uppercase/i.test(message)) return 'uppercase'
  if (/lowercase/i.test(message)) return 'lowercase'
  if (/numeric|number/i.test(message)) return 'number'
  if (/symbol/i.test(message)) return 'symbol'
  return null
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

function mapSignInResult(response: CognitoAuthenticationResponse, fallbackUsername: string): CognitoSignInResult {
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

  // Round 14 (2.11): members who turned on an authenticator app answer a TOTP code next.
  if (response.ChallengeName === 'SOFTWARE_TOKEN_MFA' && response.Session) {
    return {
      kind: 'software-token-mfa',
      session: response.Session,
      username: response.ChallengeParameters?.USER_ID_FOR_SRP || fallbackUsername,
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
      const error = payload as { __type?: unknown; code?: unknown; message?: unknown }
      const code = normalizeErrorCode(error.__type ?? error.code)
      throw new CognitoApiError(
        code,
        undefined,
        lambdaRefusalReason(code, error.message) ?? passwordRuleReason(code, error.message) ?? notAuthorizedReason(code, error.message),
      )
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

      return mapSignInResult(response, input.username)
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

    async respondToSoftwareTokenMfa(input: {
      username: string
      session: string
      code: string
    }): Promise<CognitoAuthenticationResult> {
      const response = await request<CognitoAuthenticationResponse>('RespondToAuthChallenge', {
        ChallengeName: 'SOFTWARE_TOKEN_MFA',
        ClientId: config.clientId,
        Session: input.session,
        ChallengeResponses: {
          USERNAME: input.username,
          SOFTWARE_TOKEN_MFA_CODE: input.code,
        },
      })

      return mapAuthenticationTokens(response)
    },

    /**
     * Round I (I3): GetTokensFromRefreshToken, which works with refresh token rotation on (it then returns a new
     * refresh token and retires the old one after the grace period) and off (no new refresh token). Only when
     * Cognito does not offer that operation does it fall back to REFRESH_TOKEN_AUTH; an expired, revoked or
     * rotated-out token (NotAuthorizedException) is never retried.
     */
    async refresh(refreshToken: string): Promise<CognitoAuthenticationResult> {
      try {
        const rotated = await request<CognitoAuthenticationResponse>('GetTokensFromRefreshToken', {
          ClientId: config.clientId,
          RefreshToken: refreshToken,
        })
        return mapAuthenticationTokens(rotated)
      } catch (error) {
        if (!(error instanceof CognitoApiError) || !REFRESH_FALLBACK_CODES.has(error.code)) throw error
      }

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
        username: response.Username ?? null,
        email: attributes.get('email') ?? null,
        emailVerified: attributes.get('email_verified') === 'true',
        phoneNumber: attributes.get('phone_number') ?? null,
        phoneNumberVerified: attributes.get('phone_number_verified') === 'true',
        name: attributes.get('name') ?? null,
      }
    },

    /** Uncached GetUser: the member's authenticator-app status right now (never logged). */
    async getUserMfaSettings(accessToken: string): Promise<CognitoUserMfaSettings> {
      const response = await request<CognitoGetUserResponse>('GetUser', {
        AccessToken: accessToken,
      })
      const email = (response.UserAttributes ?? []).find((attribute) => attribute.Name === 'email')?.Value ?? null

      return {
        username: response.Username ?? null,
        email,
        softwareTokenEnabled: (response.UserMFASettingList ?? []).includes('SOFTWARE_TOKEN_MFA'),
        preferredMfa: response.PreferredMfaSetting ?? null,
      }
    },

    /** Starts authenticator-app setup. The secret is shown to the member once and never stored or logged. */
    async associateSoftwareToken(accessToken: string): Promise<{ secretCode: string }> {
      const response = await request<CognitoAssociateSoftwareTokenResponse>('AssociateSoftwareToken', {
        AccessToken: accessToken,
      })
      if (!response.SecretCode) throw new CognitoApiError('UnexpectedResponse')
      return { secretCode: response.SecretCode }
    },

    async verifySoftwareToken(input: {
      accessToken: string
      code: string
      friendlyDeviceName?: string
    }): Promise<CognitoSoftwareTokenVerification> {
      const response = await request<CognitoVerifySoftwareTokenResponse>('VerifySoftwareToken', {
        AccessToken: input.accessToken,
        UserCode: input.code,
        ...(input.friendlyDeviceName ? { FriendlyDeviceName: input.friendlyDeviceName } : {}),
      })
      return { status: response.Status === 'SUCCESS' ? 'SUCCESS' : 'ERROR' }
    },

    /** Turns authenticator-app MFA on (and preferred) or off for the signed-in member. */
    async setSoftwareTokenMfaPreference(input: { accessToken: string; enabled: boolean }): Promise<void> {
      await request('SetUserMFAPreference', {
        AccessToken: input.accessToken,
        SoftwareTokenMfaSettings: {
          Enabled: input.enabled,
          PreferredMfa: input.enabled,
        },
      })
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

    async resendConfirmationCode(username: string): Promise<void> {
      await request('ResendConfirmationCode', {
        ClientId: config.clientId,
        Username: username,
      })
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

    async deleteUser(accessToken: string): Promise<void> {
      await request('DeleteUser', {
        AccessToken: accessToken,
      })
    },

    async globalSignOut(accessToken: string): Promise<void> {
      await request('GlobalSignOut', {
        AccessToken: accessToken,
      })
    },

    /**
     * Round H (H3): per-device sign-out. Revokes this refresh token and every access token issued from it (the
     * pool client has token revocation on), and leaves the member's other devices signed in.
     */
    async revokeToken(refreshToken: string): Promise<void> {
      await request('RevokeToken', {
        ClientId: config.clientId,
        Token: refreshToken,
      })
    },

    /** Round H (H3): Settings › Account › Change password, with the member's own access token. */
    async changePassword(input: { accessToken: string; previousPassword: string; proposedPassword: string }): Promise<void> {
      await request('ChangePassword', {
        AccessToken: input.accessToken,
        PreviousPassword: input.previousPassword,
        ProposedPassword: input.proposedPassword,
      })
    },

    /**
     * Round H (H3): asks Cognito to change the member's email. The pool keeps the old address until the new one is
     * verified (AttributesRequireVerificationBeforeUpdate), and Cognito sends the code to the new address.
     */
    async requestEmailChange(input: { accessToken: string; email: string }): Promise<void> {
      await request('UpdateUserAttributes', {
        AccessToken: input.accessToken,
        UserAttributes: [{ Name: 'email', Value: input.email }],
      })
    },

    /** Round H (H3): confirms the pending email change with the code sent to the new address. */
    async verifyEmailChange(input: { accessToken: string; code: string }): Promise<void> {
      await request('VerifyUserAttribute', {
        AccessToken: input.accessToken,
        AttributeName: 'email',
        Code: input.code,
      })
    },
  }
}
