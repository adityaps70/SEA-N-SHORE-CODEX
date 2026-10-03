import { z } from 'zod'
import { CognitoApiError, type CognitoCustomAuthResult, type CognitoPrincipal } from '@/lib/auth/cognito-api'
import { cognitoCookieOptions } from '@/lib/auth/cognito-cookies'
import { isPhoneLoginEmail } from '@/features/auth/phone-auth-admin'
import { displayPhoneNumber, MAX_CODES_PER_NUMBER_PER_HOUR, MAX_CODES_PER_PROFILE_PER_HOUR, RESEND_COOLDOWN_SECONDS } from '@/features/auth/phone-link'
import type { PhoneLinkRepository, SignInIdentity } from '@/features/auth/phone-link-repository'

/**
 * How a member proves it is really them before deleting the account, decided from the
 * session they are signed in with:
 * - email sign-in             -> their password (as before)
 * - mobile-only sign-in       -> a fresh one-time code texted to their verified number
 *                                (the same CUSTOM_AUTH SMS challenge as mobile sign-in)
 * - Google sign-in (no password at Sea N Shore) -> a Google sign-in within the last
 *                                10 minutes, read from the access token's auth_time claim
 *                                (Cognito keeps the original sign-in time across refreshes)
 */

export const RECENT_SIGN_IN_MINUTES = 10

export type DeletionReauth =
  | { method: 'password' }
  | { method: 'phone_code'; phoneNumber: string; username: string }
  | { method: 'recent_sign_in'; username: string; fresh: boolean }
  | { method: 'unavailable' }

/** What the delete-account screen needs (no usernames). */
export type DeletionReauthView =
  | { method: 'password' }
  | { method: 'phone_code'; phoneNumber: string }
  | { method: 'recent_sign_in'; fresh: boolean }
  | { method: 'unavailable' }

export function reauthView(reauth: DeletionReauth): DeletionReauthView {
  if (reauth.method === 'phone_code') return { method: 'phone_code', phoneNumber: reauth.phoneNumber }
  if (reauth.method === 'recent_sign_in') return { method: 'recent_sign_in', fresh: reauth.fresh }
  return { method: reauth.method }
}

const FEDERATED_USERNAME = /^(google|facebook|signinwithapple|loginwithamazon)_/i

/** Claims of a Cognito access token (already validated with Cognito by the session check). */
export function accessTokenClaims(accessToken: string | null | undefined): { authTime: Date | null; username: string | null } {
  const payload = accessToken?.split('.')[1]
  if (!payload) return { authTime: null, username: null }
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { auth_time?: unknown; username?: unknown }
    return {
      authTime: typeof decoded.auth_time === 'number' && Number.isFinite(decoded.auth_time) ? new Date(decoded.auth_time * 1000) : null,
      username: typeof decoded.username === 'string' && decoded.username ? decoded.username : null,
    }
  } catch {
    return { authTime: null, username: null }
  }
}

/** Pure: which check applies to this session. */
export function resolveDeletionReauth(input: {
  /** The identity_accounts row of the Cognito user this session belongs to. */
  identity: Pick<SignInIdentity, 'email' | 'providerUsername' | 'phoneNumber' | 'phoneNumberVerified'> | null
  sessionEmail: string | null
  sessionUsername: string | null
  authTime: Date | null
  now: Date
}): DeletionReauth {
  const username = input.identity?.providerUsername ?? input.sessionUsername
  const email = input.identity?.email ?? input.sessionEmail
  if (username && FEDERATED_USERNAME.test(username)) {
    const fresh = Boolean(input.authTime && input.now.getTime() - input.authTime.getTime() <= RECENT_SIGN_IN_MINUTES * 60_000
      && input.authTime.getTime() <= input.now.getTime() + 60_000)
    return { method: 'recent_sign_in', username, fresh }
  }
  if (isPhoneLoginEmail(email)) {
    return input.identity?.phoneNumber && input.identity.phoneNumberVerified && username
      ? { method: 'phone_code', phoneNumber: input.identity.phoneNumber, username }
      : { method: 'unavailable' }
  }
  return email ? { method: 'password' } : { method: 'unavailable' }
}

export const DELETION_CODE_COOKIES = {
  session: 'sns_delete_code_session',
  pending: 'sns_delete_code',
} as const

export const DELETION_CODE_MESSAGES = {
  cooldown: (seconds: number) => `Please wait ${seconds} seconds before asking for another code.`,
  tooMany: 'Too many codes were requested. Please wait an hour and try again.',
  busy: 'Our text message service is busy right now. Please wait a few minutes and try again.',
  sendFailed: 'We couldn’t send a code to your mobile number. Please try again.',
  noPending: 'Send a code to your mobile number first.',
  codeFormat: 'Enter the 6-digit code from the text message.',
  wrong: 'That code isn’t right. Check the text message and try again.',
  expired: 'This code has expired or was entered wrong too many times. Send a new code.',
  failed: 'We couldn’t check the code just now. Please try again.',
} as const

type CookieStore = {
  get(name: string): { name: string; value: string } | undefined
  set(name: string, value: string, options?: Record<string, unknown>): void
  delete(name: string): void
}

type CodeApi = {
  startCustomAuth(username: string): Promise<CognitoCustomAuthResult>
  respondToCustomChallenge(input: { username: string; session: string; answer: string }): Promise<CognitoCustomAuthResult>
  getUser(accessToken: string): Promise<CognitoPrincipal>
}

type Member = { id: string; cognitoSub: string }

export type SendCodeResult = { ok: true; message: string } | { ok: false; error: string }
export type VerifyCodeResult = { ok: true; accessToken: string } | { ok: false; error: string; expired?: boolean }

function isThrottled(error: unknown) {
  return error instanceof CognitoApiError && (error.code === 'TooManyRequestsException' || error.code === 'LimitExceededException')
}

/** One-time codes for deleting a mobile-only account. Nothing here deletes anything. */
export function createDeletionCodeService(input: {
  api: CodeApi
  repository: Pick<PhoneLinkRepository, 'codeRequestHistory' | 'recordCodeRequest'>
  cookieStore: CookieStore
  siteUrl: string
  allowInsecureHttpCookies?: boolean
  now?: () => Date
}) {
  const now = input.now ?? (() => new Date())
  const options = { ...cognitoCookieOptions(input.siteUrl, { allowInsecureHttp: input.allowInsecureHttpCookies === true }), maxAge: 10 * 60 }

  function write(pending: { profileId: string; username: string }, session: string) {
    input.cookieStore.set(DELETION_CODE_COOKIES.session, session, options)
    input.cookieStore.set(DELETION_CODE_COOKIES.pending, Buffer.from(JSON.stringify(pending)).toString('base64url'), options)
  }

  function clear() {
    input.cookieStore.delete(DELETION_CODE_COOKIES.session)
    input.cookieStore.delete(DELETION_CODE_COOKIES.pending)
  }

  function read(profileId: string) {
    const session = input.cookieStore.get(DELETION_CODE_COOKIES.session)?.value
    const raw = input.cookieStore.get(DELETION_CODE_COOKIES.pending)?.value
    if (!session || !raw) return null
    try {
      const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { profileId?: unknown; username?: unknown }
      if (value.profileId !== profileId || typeof value.username !== 'string') return null
      return { session, username: value.username }
    } catch {
      return null
    }
  }

  return {
    async sendCode(member: Member, reauth: Extract<DeletionReauth, { method: 'phone_code' }>): Promise<SendCodeResult> {
      try {
        const history = await input.repository.codeRequestHistory(member.id, reauth.phoneNumber)
        if (history.lastForProfileAt) {
          const waited = Math.floor((now().getTime() - history.lastForProfileAt.getTime()) / 1000)
          if (waited < RESEND_COOLDOWN_SECONDS) return { ok: false, error: DELETION_CODE_MESSAGES.cooldown(RESEND_COOLDOWN_SECONDS - Math.max(waited, 0)) }
        }
        if (history.forProfileLastHour >= MAX_CODES_PER_PROFILE_PER_HOUR || history.forPhoneLastHour >= MAX_CODES_PER_NUMBER_PER_HOUR) {
          return { ok: false, error: DELETION_CODE_MESSAGES.tooMany }
        }
        await input.repository.recordCodeRequest(member.id, reauth.phoneNumber)
        const challenge = await input.api.startCustomAuth(reauth.username)
        if (challenge.kind !== 'challenge') return { ok: false, error: DELETION_CODE_MESSAGES.sendFailed }
        write({ profileId: member.id, username: challenge.username }, challenge.session)
        return { ok: true, message: `We sent a 6-digit code to ${displayPhoneNumber(reauth.phoneNumber)}.` }
      } catch (error) {
        if (isThrottled(error)) return { ok: false, error: DELETION_CODE_MESSAGES.busy }
        return { ok: false, error: DELETION_CODE_MESSAGES.sendFailed }
      }
    },

    /** Answers the challenge; the fresh tokens must belong to the signed-in member's own Cognito user. */
    async verifyCode(member: Member, rawCode: unknown): Promise<VerifyCodeResult> {
      const pending = read(member.id)
      if (!pending) return { ok: false, error: DELETION_CODE_MESSAGES.noPending, expired: true }
      const code = z.string().trim().regex(/^\d{6}$/).safeParse(rawCode)
      if (!code.success) return { ok: false, error: DELETION_CODE_MESSAGES.codeFormat }
      try {
        const result = await input.api.respondToCustomChallenge({ username: pending.username, session: pending.session, answer: code.data })
        if (result.kind === 'challenge') {
          write({ profileId: member.id, username: result.username }, result.session)
          return { ok: false, error: DELETION_CODE_MESSAGES.wrong }
        }
        const principal = await input.api.getUser(result.authentication.accessToken)
        clear()
        if (principal.sub !== member.cognitoSub) return { ok: false, error: DELETION_CODE_MESSAGES.expired, expired: true }
        return { ok: true, accessToken: result.authentication.accessToken }
      } catch (error) {
        if (error instanceof CognitoApiError && (error.code === 'NotAuthorizedException' || error.code === 'ExpiredCodeException')) {
          clear()
          return { ok: false, error: DELETION_CODE_MESSAGES.expired, expired: true }
        }
        if (isThrottled(error)) return { ok: false, error: DELETION_CODE_MESSAGES.busy }
        return { ok: false, error: DELETION_CODE_MESSAGES.failed }
      }
    },
  }
}
