import { describe, expect, it, vi } from 'vitest'
import { CognitoApiError } from '@/lib/auth/cognito-api'
import { createCognitoAuthActions } from './cognito-actions'
import { createAuthEmailLimiter, deriveAuthEmailLimitKey, type AuthEmailLimitDecision, type AuthEmailLimiter } from './email-limits'

const RATE_LIMITED = 'Too many attempts. Please wait a while and try again.'
const PERMANENT_EMAIL = 'Please use a permanent email address.'

function fakeApi() {
  return {
    signIn: vi.fn(),
    respondToNewPassword: vi.fn(),
    signUp: vi.fn(async () => ({ userSub: 'sub1', userConfirmed: false })),
    resendConfirmationCode: vi.fn(async () => undefined),
    confirmSignUp: vi.fn(async () => undefined),
    forgotPassword: vi.fn(async () => undefined),
    confirmForgotPassword: vi.fn(async () => undefined),
    globalSignOut: vi.fn(async () => undefined),
  }
}

function form(values: Record<string, string>) {
  const data = new FormData()
  Object.entries(values).forEach(([key, value]) => data.set(key, value))
  return data
}

const cookieStore = { get: () => undefined, set: () => undefined, delete: () => undefined }

function setup(decision: AuthEmailLimitDecision = { allowed: true, counted: true }, clientIp: string | null = '203.0.113.7') {
  const api = fakeApi()
  const consume = vi.fn<AuthEmailLimiter['consume']>(async () => decision)
  const actions = createCognitoAuthActions({
    api: api as never,
    cookieStore,
    siteUrl: 'https://staging.example.com',
    onCognitoIssue: vi.fn(),
    emailLimiter: { consume },
    clientIp,
  })
  return { api, consume, actions }
}

const signUpForm = (email = 'new@example.com') => form({ fullName: 'New Mariner', email, password: 'LongEnoughPass1!' })

describe('Cognito email flows: disposable addresses (Round 14, 2.7)', () => {
  it.each([
    'someone@mailinator.com',
    'Someone@MAILINATOR.COM',
    'crew@inbox.guerrillamail.com',
    'crew@yopmail.fr',
  ])('refuses sign-up with %s before Cognito or the limiter', async (email) => {
    const { api, consume, actions } = setup()
    await expect(actions.signUp({}, signUpForm(email))).resolves.toEqual({ error: PERMANENT_EMAIL })
    expect(api.signUp).not.toHaveBeenCalled()
    expect(consume).not.toHaveBeenCalled()
  })

  it('lets ordinary and look-alike addresses sign up', async () => {
    const { api, actions } = setup()
    await expect(actions.signUp({}, signUpForm('captain@notmailinator.com'))).resolves.toEqual({ message: 'Check your email to continue.' })
    expect(api.signUp).toHaveBeenCalledTimes(1)
  })
})

describe('Cognito email flows: per-email and per-IP limits (Round 14, 2.6)', () => {
  it('passes the normalized email, the action and the trusted client IP to the limiter', async () => {
    const { consume, actions } = setup()
    await actions.signUp({}, signUpForm(' New@Example.com '))
    await actions.resendConfirmationCode({}, form({ email: 'New@Example.com' }))
    await actions.requestPasswordReset({}, form({ email: 'New@Example.com' }))
    expect(consume.mock.calls.map(([input]) => input)).toEqual([
      { action: 'sign_up', email: 'new@example.com', ip: '203.0.113.7' },
      { action: 'resend_code', email: 'new@example.com', ip: '203.0.113.7' },
      { action: 'password_reset', email: 'new@example.com', ip: '203.0.113.7' },
    ])
  })

  it('passes a null IP when the request has no trusted client address', async () => {
    const { consume, actions } = setup(undefined, null)
    await actions.requestPasswordReset({}, form({ email: 'new@example.com' }))
    expect(consume).toHaveBeenCalledWith({ action: 'password_reset', email: 'new@example.com', ip: null })
  })

  it('does not consult the limiter for invalid input', async () => {
    const { consume, actions } = setup()
    await actions.signUp({}, form({ fullName: 'X', email: 'bad', password: 'short' }))
    await actions.resendConfirmationCode({}, form({ email: 'bad' }))
    await actions.requestPasswordReset({}, form({ email: 'bad' }))
    expect(consume).not.toHaveBeenCalled()
  })

  it.each([
    ['email', 'email'],
    ['ip', 'ip'],
  ] as const)('shows the generic message and skips Cognito when sign-up is limited by %s', async (_label, scope) => {
    const { api, actions } = setup({ allowed: false, reason: 'rate_limited', scope })
    await expect(actions.signUp({}, signUpForm())).resolves.toEqual({ error: RATE_LIMITED })
    expect(api.signUp).not.toHaveBeenCalled()
    expect(api.resendConfirmationCode).not.toHaveBeenCalled()
  })

  it('shows the generic message and skips Cognito when resend is limited', async () => {
    const { api, actions } = setup({ allowed: false, reason: 'rate_limited', scope: 'email' })
    await expect(actions.resendConfirmationCode({}, form({ email: 'new@example.com' }))).resolves.toEqual({ error: RATE_LIMITED })
    expect(api.resendConfirmationCode).not.toHaveBeenCalled()
  })

  it('keeps password reset non-enumerating: the limited message is the same for every address', async () => {
    const existing = setup({ allowed: false, reason: 'rate_limited', scope: 'email' })
    const missing = setup({ allowed: false, reason: 'rate_limited', scope: 'email' })
    missing.api.forgotPassword.mockRejectedValue(new CognitoApiError('UserNotFoundException'))
    const first = await existing.actions.requestPasswordReset({}, form({ email: 'member@example.com' }))
    const second = await missing.actions.requestPasswordReset({}, form({ email: 'nobody@example.com' }))
    expect(first).toEqual({ error: RATE_LIMITED })
    expect(second).toEqual(first)
    expect(existing.api.forgotPassword).not.toHaveBeenCalled()
    expect(missing.api.forgotPassword).not.toHaveBeenCalled()
  })

  it('keeps sign-up of an existing address non-enumerating while under the limit', async () => {
    const { api, actions } = setup()
    api.signUp.mockRejectedValueOnce(new CognitoApiError('UsernameExistsException'))
    await expect(actions.signUp({}, signUpForm())).resolves.toEqual({ message: 'Check your email to continue.' })
  })

  it.each([
    ['signUp', 'We could not create your account. Please try again.'],
    ['resendConfirmationCode', 'We could not resend the confirmation code. Please check the email address or try again.'],
    ['requestPasswordReset', 'We could not request a reset code. Please try again.'],
  ] as const)('shows the flow\'s own retry message when the limiter fails closed (%s)', async (flow, message) => {
    const { api, actions } = setup({ allowed: false, reason: 'unavailable' })
    const data = flow === 'signUp' ? signUpForm() : form({ email: 'new@example.com' })
    await expect(actions[flow]({}, data)).resolves.toEqual({ error: message })
    expect(api.signUp).not.toHaveBeenCalled()
    expect(api.resendConfirmationCode).not.toHaveBeenCalled()
    expect(api.forgotPassword).not.toHaveBeenCalled()
  })

  it('records an attempt that Cognito then rejects, so failures still count toward the limit', async () => {
    let inserts = 0
    const limiter = createAuthEmailLimiter({
      getKey: () => deriveAuthEmailLimitKey('k'.repeat(40)),
      warn: vi.fn(),
      withTransaction: async (fn) => fn(async (text) => {
        if (text.includes('to_regclass')) return [{ ready: true }]
        if (text.includes('as email_total')) return [{ email_total: inserts, ip_total: inserts }]
        if (text.includes('insert into')) inserts += 1
        return []
      }),
    })
    const api = fakeApi()
    api.forgotPassword.mockRejectedValue(new CognitoApiError('TooManyRequestsException'))
    const actions = createCognitoAuthActions({ api: api as never, cookieStore, siteUrl: 'https://staging.example.com', emailLimiter: limiter, clientIp: null })
    for (let index = 0; index < 5; index += 1) {
      await expect(actions.requestPasswordReset({}, form({ email: 'new@example.com' }))).resolves.toEqual({
        error: 'We could not request a reset code. Please try again.',
      })
    }
    await expect(actions.requestPasswordReset({}, form({ email: 'new@example.com' }))).resolves.toEqual({ error: RATE_LIMITED })
    expect(api.forgotPassword).toHaveBeenCalledTimes(5)
    expect(inserts).toBe(5)
  })

  it('keeps working without a limiter (unchanged behaviour)', async () => {
    const api = fakeApi()
    const actions = createCognitoAuthActions({ api: api as never, cookieStore, siteUrl: 'https://staging.example.com' })
    await expect(actions.requestPasswordReset({}, form({ email: 'new@example.com' }))).resolves.toEqual({
      message: 'If the account exists, a reset code is on its way.',
      next: 'confirm-reset',
    })
  })
})
