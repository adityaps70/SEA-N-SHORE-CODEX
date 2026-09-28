import { describe, expect, it, vi } from 'vitest'
import { CognitoApiError } from '@/lib/auth/cognito-api'
import {
  accessTokenClaims,
  createDeletionCodeService,
  DELETION_CODE_COOKIES,
  DELETION_CODE_MESSAGES,
  resolveDeletionReauth,
} from './reauth'

const NOW = new Date('2026-09-28T10:00:00.000Z')
const phoneEmail = 'phone-0123456789abcdef0123456789abcdef@auth.seaandshore.in'
const member = { id: '11111111-1111-4111-8111-111111111111', cognitoSub: 'phone-sub' }

function token(claims: Record<string, unknown>) {
  return `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`
}

describe('choosing how a member confirms deletion', () => {
  it('uses the password for email sign-ins', () => {
    expect(resolveDeletionReauth({
      identity: { email: 'meera@example.com', providerUsername: 'uuid-1', phoneNumber: null, phoneNumberVerified: false },
      sessionEmail: 'meera@example.com', sessionUsername: 'uuid-1', authTime: null, now: NOW,
    })).toEqual({ method: 'password' })
  })

  it('texts a code to mobile-only sign-ins with a verified number', () => {
    expect(resolveDeletionReauth({
      identity: { email: phoneEmail, providerUsername: 'phone-user', phoneNumber: '+919876543210', phoneNumberVerified: true },
      sessionEmail: phoneEmail, sessionUsername: 'phone-user', authTime: null, now: NOW,
    })).toEqual({ method: 'phone_code', phoneNumber: '+919876543210', username: 'phone-user' })
    expect(resolveDeletionReauth({
      identity: { email: phoneEmail, providerUsername: 'phone-user', phoneNumber: '+919876543210', phoneNumberVerified: false },
      sessionEmail: phoneEmail, sessionUsername: 'phone-user', authTime: null, now: NOW,
    })).toEqual({ method: 'unavailable' })
  })

  it('needs a Google sign-in within the last 10 minutes for Google members', () => {
    const identity = { email: 'meera@gmail.com', providerUsername: 'Google_1234', phoneNumber: null, phoneNumberVerified: false }
    expect(resolveDeletionReauth({ identity, sessionEmail: 'meera@gmail.com', sessionUsername: 'Google_1234', authTime: new Date(NOW.getTime() - 9 * 60_000), now: NOW }))
      .toEqual({ method: 'recent_sign_in', username: 'Google_1234', fresh: true })
    expect(resolveDeletionReauth({ identity, sessionEmail: 'meera@gmail.com', sessionUsername: 'Google_1234', authTime: new Date(NOW.getTime() - 11 * 60_000), now: NOW }))
      .toEqual({ method: 'recent_sign_in', username: 'Google_1234', fresh: false })
    expect(resolveDeletionReauth({ identity, sessionEmail: 'meera@gmail.com', sessionUsername: null, authTime: null, now: NOW }))
      .toMatchObject({ fresh: false })
  })

  it('reads auth_time and username from the access token', () => {
    expect(accessTokenClaims(token({ auth_time: 1790000000, username: 'Google_1' }))).toEqual({ authTime: new Date(1790000000 * 1000), username: 'Google_1' })
    expect(accessTokenClaims('not-a-token')).toEqual({ authTime: null, username: null })
    expect(accessTokenClaims(null)).toEqual({ authTime: null, username: null })
  })
})

describe('deletion codes for mobile-only members', () => {
  function setup(history = { lastForProfileAt: null as Date | null, forProfileLastHour: 0, forPhoneLastHour: 0 }) {
    const values = new Map<string, string>()
    const cookieStore = {
      get: (name: string) => (values.has(name) ? { name, value: values.get(name)! } : undefined),
      set: (name: string, value: string) => { values.set(name, value) },
      delete: (name: string) => { values.delete(name) },
    }
    const api = {
      startCustomAuth: vi.fn(async (username: string) => ({ kind: 'challenge' as const, session: 's1', username })),
      respondToCustomChallenge: vi.fn(async () => ({ kind: 'authenticated' as const, authentication: { accessToken: 'fresh', expiresIn: 3600 } })),
      getUser: vi.fn(async () => ({ sub: 'phone-sub', email: phoneEmail, emailVerified: false, name: null })),
    }
    const repository = { codeRequestHistory: vi.fn(async () => history), recordCodeRequest: vi.fn(async () => undefined) }
    const service = createDeletionCodeService({ api, repository, cookieStore, siteUrl: 'https://staging.example.com', now: () => NOW })
    return { service, api, repository, values }
  }
  const reauth = { method: 'phone_code' as const, phoneNumber: '+919876543210', username: 'phone-user' }

  it('sends a code to the verified number and returns a fresh token for the member’s own sign-in', async () => {
    const { service, api, repository, values } = setup()
    await expect(service.sendCode(member, reauth)).resolves.toEqual({ ok: true, message: 'We sent a 6-digit code to +91 98765 43210.' })
    expect(api.startCustomAuth).toHaveBeenCalledWith('phone-user')
    expect(repository.recordCodeRequest).toHaveBeenCalledWith(member.id, '+919876543210')
    await expect(service.verifyCode(member, '123456')).resolves.toEqual({ ok: true, accessToken: 'fresh' })
    expect(values.has(DELETION_CODE_COOKIES.session)).toBe(false)
  })

  it('refuses tokens that belong to another sign-in, wrong or expired codes, and a missing code', async () => {
    const other = setup()
    await other.service.sendCode(member, reauth)
    other.api.getUser.mockResolvedValueOnce({ sub: 'someone-else', email: phoneEmail, emailVerified: false, name: null })
    await expect(other.service.verifyCode(member, '123456')).resolves.toMatchObject({ ok: false, expired: true })

    const wrong = setup()
    await wrong.service.sendCode(member, reauth)
    wrong.api.respondToCustomChallenge.mockResolvedValueOnce({ kind: 'challenge', session: 's2', username: 'phone-user' } as never)
    await expect(wrong.service.verifyCode(member, '000000')).resolves.toEqual({ ok: false, error: DELETION_CODE_MESSAGES.wrong })
    wrong.api.respondToCustomChallenge.mockRejectedValueOnce(new CognitoApiError('NotAuthorizedException'))
    await expect(wrong.service.verifyCode(member, '000000')).resolves.toMatchObject({ ok: false, error: DELETION_CODE_MESSAGES.expired })

    const none = setup()
    await expect(none.service.verifyCode(member, '123456')).resolves.toMatchObject({ ok: false, error: DELETION_CODE_MESSAGES.noPending })
    expect(none.api.respondToCustomChallenge).not.toHaveBeenCalled()
  })

  it('rate-limits codes', async () => {
    const { service, api } = setup({ lastForProfileAt: new Date(NOW.getTime() - 5_000), forProfileLastHour: 1, forPhoneLastHour: 1 })
    await expect(service.sendCode(member, reauth)).resolves.toEqual({ ok: false, error: DELETION_CODE_MESSAGES.cooldown(40) })
    expect(api.startCustomAuth).not.toHaveBeenCalled()
  })
})
