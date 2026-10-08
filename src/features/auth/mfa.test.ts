import { describe, expect, it, vi } from 'vitest'
import { CognitoApiError, type CognitoUserMfaSettings } from '@/lib/auth/cognito-api'
import {
  MFA_MESSAGES,
  accessTokenScopes,
  createAuthenticatorMfaActions,
  describeMfaStatus,
  otpauthUri,
  satisfiesAdminMfa,
} from './mfa'

function token(claims: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`
}

const passwordToken = token({ sub: 'sub-1', scope: 'aws.cognito.signin.user.admin' })
const hostedToken = token({ sub: 'sub-1', scope: 'aws.cognito.signin.user.admin phone openid profile email' })

function settings(overrides: Partial<CognitoUserMfaSettings> = {}): CognitoUserMfaSettings {
  return {
    username: '6f1c2c43-1111-4111-8111-111111111111',
    email: 'captain@example.com',
    softwareTokenEnabled: false,
    preferredMfa: null,
    ...overrides,
  }
}

function form(values: Record<string, string>) {
  const data = new FormData()
  Object.entries(values).forEach(([key, value]) => data.set(key, value))
  return data
}

function setup(options: { status?: Partial<CognitoUserMfaSettings>; accessToken?: string | null; admin?: boolean | Error } = {}) {
  const api = {
    getUserMfaSettings: vi.fn(async () => settings(options.status)),
    associateSoftwareToken: vi.fn(async () => ({ secretCode: 'JBSWY3DPEHPK3PXP' })),
    verifySoftwareToken: vi.fn(async () => ({ status: 'SUCCESS' as const })),
    setSoftwareTokenMfaPreference: vi.fn(async () => undefined),
  }
  const isPlatformAdministrator = vi.fn(async () => {
    if (options.admin instanceof Error) throw options.admin
    return options.admin === true
  })
  const renderQr = vi.fn(async (uri: string) => `data:image/png;base64,${Buffer.from(uri).toString('base64')}`)
  const onIssue = vi.fn()
  const actions = createAuthenticatorMfaActions({
    api,
    getAccessToken: async () => (options.accessToken === undefined ? passwordToken : options.accessToken),
    getProfileId: async () => 'profile-1',
    isPlatformAdministrator,
    renderQr,
    onIssue,
  })
  return { api, actions, isPlatformAdministrator, renderQr, onIssue }
}

describe('MFA status (Round 14, 2.11)', () => {
  it('reads the session scopes from the access token', () => {
    expect(accessTokenScopes(passwordToken)).toEqual(['aws.cognito.signin.user.admin'])
    expect(accessTokenScopes(hostedToken)).toContain('openid')
    expect(accessTokenScopes('not-a-jwt')).toEqual([])
  })

  it('classifies email/password, Google-only and mobile sign-in accounts', () => {
    expect(describeMfaStatus(settings({ softwareTokenEnabled: true }), passwordToken)).toEqual({
      kind: 'eligible', enabled: true, email: 'captain@example.com', hostedSession: false,
    })
    expect(describeMfaStatus(settings({ username: 'Google_109876543210' }), hostedToken)).toMatchObject({ kind: 'federated', hostedSession: true })
    expect(describeMfaStatus(settings({ email: 'phone-0123456789abcdef0123456789abcdef@auth.seaandshore.in' }), passwordToken))
      .toMatchObject({ kind: 'phone' })
    // An email/password account that also linked Google, signed in through Google.
    expect(describeMfaStatus(settings({ softwareTokenEnabled: true }), hostedToken)).toMatchObject({ kind: 'eligible', enabled: true, hostedSession: true })
  })

  it('lets administrators in only with an authenticator app and a password sign-in', () => {
    expect(satisfiesAdminMfa(describeMfaStatus(settings({ softwareTokenEnabled: true }), passwordToken))).toBe(true)
    expect(satisfiesAdminMfa(describeMfaStatus(settings(), passwordToken))).toBe(false)
    expect(satisfiesAdminMfa(describeMfaStatus(settings({ softwareTokenEnabled: true }), hostedToken))).toBe(false)
    expect(satisfiesAdminMfa(describeMfaStatus(settings({ username: 'Google_1', softwareTokenEnabled: true }), passwordToken))).toBe(false)
    expect(satisfiesAdminMfa(null)).toBe(false)
  })

  it('builds a standard otpauth:// URI for authenticator apps', () => {
    expect(otpauthUri({ secret: 'JBSWY3DPEHPK3PXP', account: 'captain+sea@example.com' })).toBe(
      'otpauth://totp/Sea%20N%20Shore:captain%2Bsea%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Sea%20N%20Shore&algorithm=SHA1&digits=6&period=30',
    )
  })
})

describe('authenticator setup and management actions (Round 14, 2.11)', () => {
  it('starts setup with a new secret, its otpauth URI and a QR code', async () => {
    const { api, actions, renderQr } = setup()

    const result = await actions.startSetup()

    expect(api.associateSoftwareToken).toHaveBeenCalledWith(passwordToken)
    expect(result).toEqual({
      status: 'ready',
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: expect.stringMatching(/^otpauth:\/\/totp\/Sea%20N%20Shore:captain%40example\.com\?secret=JBSWY3DPEHPK3PXP&/),
      qrDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
    })
    expect(renderQr).toHaveBeenCalledWith(result.status === 'ready' ? result.otpauthUri : '')
  })

  it.each([
    ['Google-only', { username: 'Google_1' }, MFA_MESSAGES.ineligibleFederated],
    ['mobile sign-in', { email: 'phone-0123456789abcdef0123456789abcdef@auth.seaandshore.in' }, MFA_MESSAGES.ineligiblePhone],
    ['already on', { softwareTokenEnabled: true }, MFA_MESSAGES.alreadyOn],
  ])('does not start setup for %s accounts', async (_label, status, error) => {
    const { api, actions } = setup({ status })
    await expect(actions.startSetup()).resolves.toEqual({ status: 'error', error })
    expect(api.associateSoftwareToken).not.toHaveBeenCalled()
  })

  it('asks a signed-out or expired session to sign in again', async () => {
    await expect(setup({ accessToken: null }).actions.startSetup()).resolves.toEqual({ status: 'error', error: MFA_MESSAGES.sessionExpired })
    const expired = setup()
    expired.api.getUserMfaSettings.mockRejectedValueOnce(new CognitoApiError('NotAuthorizedException'))
    await expect(expired.actions.startSetup()).resolves.toEqual({ status: 'error', error: MFA_MESSAGES.sessionExpired })
  })

  it('verifies the code, turns authenticator MFA on and preferred, and returns to the admin page', async () => {
    const { api, actions } = setup()

    const result = await actions.confirmSetup({ status: 'idle' }, form({ code: '123 456', returnTo: '/admin/users?q=ana' }))

    expect(api.verifySoftwareToken).toHaveBeenCalledWith({ accessToken: passwordToken, code: '123456', friendlyDeviceName: 'Authenticator app' })
    expect(api.setSoftwareTokenMfaPreference).toHaveBeenCalledWith({ accessToken: passwordToken, enabled: true })
    expect(result).toEqual({ status: 'enabled', message: MFA_MESSAGES.enabled, redirectTo: '/admin/users?q=ana' })
  })

  it('never returns to a page outside the admin console', async () => {
    for (const returnTo of ['https://evil.example/admin', '//evil.example', '/home', '/admin/../settings', '/administrator']) {
      const result = await setup().actions.confirmSetup({ status: 'idle' }, form({ code: '123456', returnTo }))
      expect(result).toMatchObject({ status: 'enabled', redirectTo: null })
    }
  })

  it('refuses a malformed or wrong code without turning anything on', async () => {
    const malformed = setup()
    await expect(malformed.actions.confirmSetup({ status: 'idle' }, form({ code: '12' }))).resolves.toEqual({ status: 'error', error: MFA_MESSAGES.invalidCode })
    expect(malformed.api.verifySoftwareToken).not.toHaveBeenCalled()

    const wrong = setup()
    wrong.api.verifySoftwareToken.mockResolvedValueOnce({ status: 'ERROR' } as never)
    await expect(wrong.actions.confirmSetup({ status: 'idle' }, form({ code: '000000' }))).resolves.toEqual({ status: 'error', error: MFA_MESSAGES.wrongCode })

    const mismatch = setup()
    mismatch.api.verifySoftwareToken.mockRejectedValueOnce(new CognitoApiError('EnableSoftwareTokenMFAException'))
    await expect(mismatch.actions.confirmSetup({ status: 'idle' }, form({ code: '000000' }))).resolves.toEqual({ status: 'error', error: MFA_MESSAGES.wrongCode })

    for (const run of [wrong, mismatch]) expect(run.api.setSoftwareTokenMfaPreference).not.toHaveBeenCalled()
  })

  it('lets members turn authenticator MFA off', async () => {
    const { api, actions, isPlatformAdministrator } = setup({ status: { softwareTokenEnabled: true } })
    await expect(actions.disable()).resolves.toEqual({ status: 'disabled', message: MFA_MESSAGES.disabled })
    expect(isPlatformAdministrator).toHaveBeenCalledWith('profile-1')
    expect(api.setSoftwareTokenMfaPreference).toHaveBeenCalledWith({ accessToken: passwordToken, enabled: false })
  })

  it('never lets a platform administrator turn it off, and fails closed when that check fails', async () => {
    const admin = setup({ admin: true })
    await expect(admin.actions.disable()).resolves.toEqual({ status: 'error', error: MFA_MESSAGES.adminCannotDisable })
    expect(admin.api.setSoftwareTokenMfaPreference).not.toHaveBeenCalled()

    const unknown = setup({ admin: new Error('database_unavailable') })
    await expect(unknown.actions.disable()).resolves.toEqual({ status: 'error', error: MFA_MESSAGES.disableFailed })
    expect(unknown.api.setSoftwareTokenMfaPreference).not.toHaveBeenCalled()
  })

  it('reports failures by operation and Cognito code only, never the secret or code', async () => {
    const { api, actions, onIssue } = setup()
    api.verifySoftwareToken.mockRejectedValueOnce(new CognitoApiError('InternalErrorException'))

    await expect(actions.confirmSetup({ status: 'idle' }, form({ code: '424242' }))).resolves.toEqual({ status: 'error', error: MFA_MESSAGES.verifyFailed })
    expect(onIssue).toHaveBeenCalledWith({ operation: 'verifySoftwareToken', reason: 'InternalError' })
    expect(JSON.stringify(onIssue.mock.calls)).not.toMatch(/424242|JBSWY3DPEHPK3PXP|signature/)
  })
})
