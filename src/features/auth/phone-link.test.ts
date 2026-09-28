import { describe, expect, it, vi } from 'vitest'
import { CognitoApiError } from '@/lib/auth/cognito-api'
import { COGNITO_COOKIE_NAMES } from '@/lib/auth/cognito-cookies'
import {
  composePhoneNumber,
  createPhoneLinkService,
  displayPhoneNumber,
  PHONE_LINK_COOKIES,
  PHONE_LINK_MESSAGES,
} from './phone-link'
import { PhoneNumberInUseError, type SignInIdentity } from './phone-link-repository'

const profileId = '11111111-1111-4111-8111-111111111111'
const otherProfileId = '22222222-2222-4222-8222-222222222222'
const member = { id: profileId, cognitoSub: 'email-sub' }
const phone = '+919876543210'
const phoneEmail = 'phone-0123456789abcdef0123456789abcdef@auth.seaandshore.in'
const NOW = new Date('2026-09-28T10:00:00.000Z')

function fakeCookies(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    store: {
      get(name: string) {
        const value = values.get(name)
        return value === undefined ? undefined : { name, value }
      },
      set(name: string, value: string) { values.set(name, value) },
      delete(name: string) { values.delete(name) },
    },
  }
}

function identity(overrides: Partial<SignInIdentity> = {}): SignInIdentity {
  return {
    id: 'identity-email',
    providerSubject: 'email-sub',
    providerUsername: 'email-sub',
    email: 'meera@example.com',
    emailVerified: true,
    phoneNumber: null,
    phoneNumberVerified: false,
    ...overrides,
  }
}

function setup(options: {
  identities?: SignInIdentity[]
  owners?: string[]
  history?: { lastForProfileAt: Date | null; forProfileLastHour: number; forPhoneLastHour: number }
  existingUser?: { username: string; sub: string | null; email: string | null; verified: boolean } | null
  linkedTo?: string | null
  cookies?: Record<string, string>
} = {}) {
  const cookies = fakeCookies(options.cookies)
  const api = {
    startCustomAuth: vi.fn(async (username: string) => ({ kind: 'challenge' as const, session: 'link-session', username })),
    respondToCustomChallenge: vi.fn(async () => ({
      kind: 'authenticated' as const,
      authentication: { accessToken: 'phone-access', refreshToken: 'phone-refresh', expiresIn: 3600 },
    })),
    getUser: vi.fn(async () => ({
      sub: 'phone-sub', username: 'phone-user', email: phoneEmail, emailVerified: false,
      phoneNumber: phone, phoneNumberVerified: false, name: 'Meera Rao',
    })),
    globalSignOut: vi.fn(async () => undefined),
  }
  const admin = {
    findPhoneLoginUser: vi.fn(async () => (options.existingUser === undefined ? null : options.existingUser)),
    createPhoneUser: vi.fn(async () => ({ username: 'phone-user' })),
    markPhoneVerified: vi.fn(async () => undefined),
    deleteUser: vi.fn(async () => undefined),
  }
  const repository = {
    listSignInIdentities: vi.fn(async () => options.identities ?? [identity()]),
    profileIdForSubject: vi.fn(async () => options.linkedTo ?? null),
    verifiedPhoneOwners: vi.fn(async () => options.owners ?? []),
    getProfileName: vi.fn(async () => 'Meera Rao'),
    codeRequestHistory: vi.fn(async () => options.history ?? { lastForProfileAt: null, forProfileLastHour: 0, forPhoneLastHour: 0 }),
    recordCodeRequest: vi.fn(async () => undefined),
    linkPhoneIdentity: vi.fn(async (_link: unknown, markVerified: () => Promise<void>) => { await markVerified() }),
    unlinkIdentity: vi.fn(async () => undefined),
  }
  const log = vi.fn()
  const service = createPhoneLinkService({
    api,
    admin,
    repository: repository as never,
    cookieStore: cookies.store,
    siteUrl: 'https://staging.example.com',
    now: () => NOW,
    log,
  })
  return { service, api, admin, repository, cookies, log }
}

function pendingCookies(overrides: Record<string, unknown> = {}) {
  return {
    [PHONE_LINK_COOKIES.session]: 'link-session',
    [PHONE_LINK_COOKIES.pending]: Buffer.from(JSON.stringify({
      profileId, username: 'phone-user', phoneNumber: phone, sentAt: NOW.getTime(), ...overrides,
    })).toString('base64url'),
  }
}

describe('phone numbers typed in Settings', () => {
  it('joins the country code and the number, and accepts a full number typed with +', () => {
    expect(composePhoneNumber('+91', '98765 43210')).toBe('+919876543210')
    expect(composePhoneNumber('+91', '098765-43210')).toBe('+919876543210')
    expect(composePhoneNumber('+44', '07700 900123')).toBe('+447700900123')
    expect(composePhoneNumber('+91', '+65 8123 4567')).toBe('+6581234567')
    expect(composePhoneNumber('+91', '12345')).toBeNull()
    expect(composePhoneNumber('+91', '5876543210')).toBeNull()
    expect(composePhoneNumber('+91', 'call me')).toBeNull()
    expect(composePhoneNumber('91', '9876543210')).toBeNull()
    expect(displayPhoneNumber('+919876543210')).toBe('+91 98765 43210')
  })
})

describe('adding a mobile number to an account', () => {
  it('creates a mobile sign-in for a new number and sends the code with the existing phone challenge', async () => {
    const { service, api, admin, repository, cookies } = setup()
    const result = await service.requestCode(member, phone)

    expect(result).toMatchObject({ status: 'code_sent', phoneNumber: phone })
    expect(admin.createPhoneUser).toHaveBeenCalledWith({ phoneNumber: phone, fullName: 'Meera Rao' })
    expect(api.startCustomAuth).toHaveBeenCalledWith('phone-user')
    expect(repository.recordCodeRequest).toHaveBeenCalledWith(profileId, phone)
    expect(cookies.values.get(PHONE_LINK_COOKIES.session)).toBe('link-session')
    // The member's own session is untouched.
    expect(cookies.values.has(COGNITO_COOKIE_NAMES.access)).toBe(false)
  })

  it('reuses an unfinished mobile sign-up for the same number instead of creating a second user', async () => {
    const { service, admin, api } = setup({ existingUser: { username: 'stale-phone-user', sub: 'stale-sub', email: phoneEmail, verified: false } })
    await expect(service.requestCode(member, phone)).resolves.toMatchObject({ status: 'code_sent' })
    expect(admin.createPhoneUser).not.toHaveBeenCalled()
    expect(api.startCustomAuth).toHaveBeenCalledWith('stale-phone-user')
  })

  it('refuses a number another account signs in with, and never sends it a code', async () => {
    const linked = setup({ existingUser: { username: 'their-user', sub: 'their-sub', email: phoneEmail, verified: true }, linkedTo: otherProfileId })
    await expect(linked.service.requestCode(member, phone)).resolves.toMatchObject({ status: 'error', error: PHONE_LINK_MESSAGES.inUse })
    expect(linked.api.startCustomAuth).not.toHaveBeenCalled()

    const recorded = setup({ owners: [otherProfileId] })
    await expect(recorded.service.requestCode(member, phone)).resolves.toMatchObject({ error: PHONE_LINK_MESSAGES.inUse })
    expect(recorded.admin.findPhoneLoginUser).not.toHaveBeenCalled()

    const onEmailAccount = setup({ existingUser: { username: 'email-user', sub: 'x', email: 'someone@example.com', verified: false } })
    await expect(onEmailAccount.service.requestCode(member, phone)).resolves.toMatchObject({ error: PHONE_LINK_MESSAGES.inUse })
    expect(onEmailAccount.api.startCustomAuth).not.toHaveBeenCalled()
  })

  it('says when the number is already on this account', async () => {
    const { service, api } = setup({ identities: [identity(), identity({ id: 'identity-phone', providerSubject: 'phone-sub', email: phoneEmail, phoneNumber: phone, phoneNumberVerified: true })] })
    await expect(service.requestCode(member, phone)).resolves.toMatchObject({ error: PHONE_LINK_MESSAGES.alreadyYours })
    expect(api.startCustomAuth).not.toHaveBeenCalled()
  })

  it('rate-limits codes per account and per number, and explains Cognito throttling', async () => {
    const soon = setup({ history: { lastForProfileAt: new Date(NOW.getTime() - 10_000), forProfileLastHour: 1, forPhoneLastHour: 1 } })
    await expect(soon.service.requestCode(member, phone)).resolves.toMatchObject({ error: PHONE_LINK_MESSAGES.cooldown(35) })
    expect(soon.api.startCustomAuth).not.toHaveBeenCalled()

    const many = setup({ history: { lastForProfileAt: new Date(NOW.getTime() - 600_000), forProfileLastHour: 5, forPhoneLastHour: 5 } })
    await expect(many.service.requestCode(member, phone)).resolves.toMatchObject({ error: PHONE_LINK_MESSAGES.tooMany })

    const throttled = setup()
    throttled.api.startCustomAuth.mockRejectedValueOnce(new CognitoApiError('LimitExceededException'))
    await expect(throttled.service.requestCode(member, phone)).resolves.toMatchObject({ error: PHONE_LINK_MESSAGES.providerBusy })
  })

  it('rejects an invalid number', async () => {
    const { service } = setup()
    await expect(service.requestCode(member, null)).resolves.toMatchObject({ status: 'error', error: PHONE_LINK_MESSAGES.invalidNumber })
  })
})

describe('confirming the code', () => {
  it('marks the number verified in Cognito and links it to the profile, without switching the session', async () => {
    const { service, api, admin, repository, cookies } = setup({ cookies: pendingCookies() })
    const result = await service.confirmCode(member, '123456')

    expect(result).toEqual({ status: 'verified', phoneNumber: phone, message: PHONE_LINK_MESSAGES.verified })
    expect(api.respondToCustomChallenge).toHaveBeenCalledWith({ username: 'phone-user', session: 'link-session', answer: '123456' })
    expect(repository.linkPhoneIdentity).toHaveBeenCalledWith(
      { profileId, sub: 'phone-sub', username: 'phone-user', email: phoneEmail, phoneNumber: phone },
      expect.any(Function),
    )
    expect(admin.markPhoneVerified).toHaveBeenCalledWith('phone-user')
    expect(api.globalSignOut).toHaveBeenCalledWith('phone-access')
    expect(cookies.values.has(PHONE_LINK_COOKIES.session)).toBe(false)
    expect(cookies.values.has(COGNITO_COOKIE_NAMES.access)).toBe(false)
  })

  it('keeps the challenge open after a wrong code', async () => {
    const { service, api, repository, cookies } = setup({ cookies: pendingCookies() })
    api.respondToCustomChallenge.mockResolvedValueOnce({ kind: 'challenge', session: 'next-session', username: 'phone-user' } as never)
    await expect(service.confirmCode(member, '000000')).resolves.toMatchObject({ status: 'error', step: 'confirm', error: PHONE_LINK_MESSAGES.wrongCode })
    expect(cookies.values.get(PHONE_LINK_COOKIES.session)).toBe('next-session')
    expect(repository.linkPhoneIdentity).not.toHaveBeenCalled()
  })

  it('asks for a new code when the code expired or was wrong too many times', async () => {
    const { service, api, repository, cookies } = setup({ cookies: pendingCookies() })
    api.respondToCustomChallenge.mockRejectedValueOnce(new CognitoApiError('NotAuthorizedException'))
    await expect(service.confirmCode(member, '000000')).resolves.toMatchObject({ status: 'error', step: 'request', error: PHONE_LINK_MESSAGES.expired })
    expect(cookies.values.has(PHONE_LINK_COOKIES.pending)).toBe(false)
    expect(repository.linkPhoneIdentity).not.toHaveBeenCalled()
  })

  it('ignores a pending verification that belongs to another profile', async () => {
    const { service, api } = setup({ cookies: pendingCookies({ profileId: otherProfileId }) })
    await expect(service.confirmCode(member, '123456')).resolves.toMatchObject({ error: PHONE_LINK_MESSAGES.noPending })
    expect(api.respondToCustomChallenge).not.toHaveBeenCalled()
  })

  it('never links when the number was taken by another account in the meantime', async () => {
    const { service, repository, admin, api } = setup({ cookies: pendingCookies() })
    repository.linkPhoneIdentity.mockRejectedValueOnce(new PhoneNumberInUseError())
    await expect(service.confirmCode(member, '123456')).resolves.toMatchObject({ status: 'error', error: PHONE_LINK_MESSAGES.inUse })
    expect(admin.markPhoneVerified).not.toHaveBeenCalled()
    expect(api.globalSignOut).toHaveBeenCalledWith('phone-access')
  })

  it('refuses tokens for a different number than the one being verified', async () => {
    const { service, api, repository } = setup({ cookies: pendingCookies() })
    api.getUser.mockResolvedValueOnce({ sub: 'x', username: 'x', email: phoneEmail, emailVerified: false, phoneNumber: '+919000000000', phoneNumberVerified: true, name: 'X' })
    await expect(service.confirmCode(member, '123456')).resolves.toMatchObject({ status: 'error', error: PHONE_LINK_MESSAGES.expired })
    expect(repository.linkPhoneIdentity).not.toHaveBeenCalled()
  })

  it('replaces the old number: removes the old mobile sign-in after the new one is linked', async () => {
    const old = identity({ id: 'identity-old-phone', providerSubject: 'old-phone-sub', providerUsername: 'old-phone-user', email: phoneEmail.replace('0123', '9999'), phoneNumber: '+919111111111', phoneNumberVerified: true })
    const { service, admin, repository, cookies } = setup({ cookies: pendingCookies(), identities: [identity(), old] })
    await expect(service.confirmCode(member, '123456')).resolves.toMatchObject({ status: 'verified' })
    expect(admin.deleteUser).toHaveBeenCalledWith('old-phone-user')
    expect(repository.unlinkIdentity).toHaveBeenCalledWith(profileId, 'identity-old-phone')
    expect(repository.linkPhoneIdentity.mock.invocationCallOrder[0]).toBeLessThan(admin.deleteUser.mock.invocationCallOrder[0]!)
    expect(cookies.values.has(COGNITO_COOKIE_NAMES.access)).toBe(false)
  })

  it('keeps a member signed in with the old number signed in with the new one', async () => {
    const old = identity({ id: 'identity-old-phone', providerSubject: 'old-phone-sub', providerUsername: 'old-phone-user', email: phoneEmail.replace('0123', '9999'), phoneNumber: '+919111111111', phoneNumberVerified: true })
    const { service, api, cookies } = setup({ cookies: pendingCookies(), identities: [old] })
    await expect(service.confirmCode({ id: profileId, cognitoSub: 'old-phone-sub' }, '123456')).resolves.toMatchObject({ status: 'verified' })
    expect(cookies.values.get(COGNITO_COOKIE_NAMES.access)).toBe('phone-access')
    expect(api.globalSignOut).not.toHaveBeenCalled()
  })
})

describe('removing a mobile number', () => {
  const phoneIdentity = identity({ id: 'identity-phone', providerSubject: 'phone-sub', providerUsername: 'phone-user', email: phoneEmail, emailVerified: false, phoneNumber: phone, phoneNumberVerified: true })

  it('deletes the mobile sign-in in Cognito before unlinking it', async () => {
    const { service, admin, repository } = setup({ identities: [identity(), phoneIdentity] })
    await expect(service.removePhone(member, 'identity-phone')).resolves.toEqual({ status: 'removed', message: PHONE_LINK_MESSAGES.removed })
    expect(admin.deleteUser).toHaveBeenCalledWith('phone-user')
    expect(repository.unlinkIdentity).toHaveBeenCalledWith(profileId, 'identity-phone')
    expect(admin.deleteUser.mock.invocationCallOrder[0]).toBeLessThan(repository.unlinkIdentity.mock.invocationCallOrder[0]!)
  })

  it('keeps the only way to sign in, and the number currently signed in with', async () => {
    const only = setup({ identities: [phoneIdentity] })
    await expect(only.service.removePhone({ id: profileId, cognitoSub: 'phone-sub' }, 'identity-phone')).resolves.toMatchObject({ error: PHONE_LINK_MESSAGES.removeOnlySignIn })
    expect(only.admin.deleteUser).not.toHaveBeenCalled()

    const current = setup({ identities: [identity(), phoneIdentity] })
    await expect(current.service.removePhone({ id: profileId, cognitoSub: 'phone-sub' }, 'identity-phone')).resolves.toMatchObject({ error: PHONE_LINK_MESSAGES.removeCurrentSession })
    expect(current.admin.deleteUser).not.toHaveBeenCalled()
  })

  it('lists verified numbers with whether they can be removed', async () => {
    const { service } = setup({ identities: [identity(), phoneIdentity], cookies: pendingCookies({ phoneNumber: '+919222222222' }) })
    await expect(service.getSummary(member)).resolves.toEqual({
      phones: [{ identityId: 'identity-phone', phoneNumber: phone, current: false, removable: true, removeBlockedReason: null }],
      pendingPhoneNumber: '+919222222222',
    })
  })
})
