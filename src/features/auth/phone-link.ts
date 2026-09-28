import { z } from 'zod'
import {
  CognitoApiError,
  type CognitoAuthenticationResult,
  type CognitoCustomAuthResult,
  type CognitoPrincipal,
} from '@/lib/auth/cognito-api'
import { cognitoCookieOptions, createCognitoCookieManager } from '@/lib/auth/cognito-cookies'
import { isPhoneLoginEmail, type PhoneLoginUser } from './phone-auth-admin'
import { PhoneNumberInUseError, type PhoneLinkRepository, type SignInIdentity } from './phone-link-repository'

/**
 * Settings > Mobile number: a signed-in member adds, replaces or removes the mobile
 * number they can use with "Continue with mobile number".
 *
 * How it works (reusing the phone sign-in pieces):
 * - A mobile sign-in is a separate Cognito user with that phone_number (the same kind of
 *   user /auth/phone creates), linked to the member's profile in identity_accounts.
 * - The code is sent by the existing CUSTOM_AUTH challenge Lambda to that user's number.
 *   Answering it proves the member holds the phone; only then is the number marked
 *   verified in Cognito and linked, in one database transaction.
 * - A number that already signs in to another member is refused (no takeover).
 * - Cognito limits wrong codes (3 per code); we also limit how often codes are sent.
 */

export const PHONE_LINK_COOKIES = {
  session: 'sns_phone_link_session',
  pending: 'sns_phone_link',
} as const

const PENDING_MAX_AGE_SECONDS = 10 * 60
export const RESEND_COOLDOWN_SECONDS = 45
export const MAX_CODES_PER_PROFILE_PER_HOUR = 5
export const MAX_CODES_PER_NUMBER_PER_HOUR = 5

export const PHONE_LINK_MESSAGES = {
  invalidNumber: 'Enter a valid mobile number with its country code, for example +91 98765 43210.',
  alreadyYours: 'This number is already on your account.',
  inUse: 'This mobile number is already used by another Sea N Shore account. Use a different number, or sign in to that account to remove it first.',
  cooldown: (seconds: number) => `Please wait ${seconds} seconds before asking for another code.`,
  tooMany: 'Too many codes were requested. Please wait an hour and try again.',
  providerBusy: 'Our text message service is busy right now. Please wait a few minutes and try again.',
  sendFailed: 'We couldn’t send a code to this number. Check it and try again.',
  codeFormat: 'Enter the 6-digit code from the text message.',
  wrongCode: 'That code isn’t right. Check the text message and try again.',
  expired: 'This code has expired or was entered wrong too many times. Request a new code.',
  noPending: 'Your verification has timed out. Request a new code.',
  verifyFailed: 'We couldn’t verify the code just now. Please try again.',
  verified: 'Your mobile number is verified. You can now use “Continue with mobile number” to sign in.',
  removeNotFound: 'We couldn’t find that number on your account. Refresh the page and try again.',
  removeOnlySignIn: 'This number is the only way you sign in, so it can’t be removed.',
  removeCurrentSession: 'You’re signed in with this number right now. Sign in another way (email or Google), then remove it.',
  removeUnsupported: 'This number is part of your main sign-in and can’t be removed here. Contact info@beaufortmarine.in for help.',
  removeFailed: 'We couldn’t remove the number just now. Please try again.',
  removed: 'Your mobile number was removed. You can no longer sign in with it.',
} as const

export type PhoneLinkState =
  | { status: 'idle' }
  | { status: 'code_sent'; phoneNumber: string; message: string }
  | { status: 'verified'; phoneNumber: string; message: string }
  | { status: 'removed'; message: string }
  | { status: 'error'; step: 'request' | 'confirm' | 'remove'; error: string; phoneNumber?: string }

export type AccountPhone = {
  identityId: string
  phoneNumber: string
  /** Signed in with this number right now. */
  current: boolean
  removable: boolean
  /** Why it can't be removed, when it can't. */
  removeBlockedReason: string | null
}

export type AccountPhoneSummary = {
  phones: AccountPhone[]
  pendingPhoneNumber: string | null
}

type CookieStore = {
  get(name: string): { name: string; value: string } | undefined
  set(name: string, value: string, options?: Record<string, unknown>): void
  delete(name: string): void
}

type PhoneLinkApi = {
  startCustomAuth(username: string): Promise<CognitoCustomAuthResult>
  respondToCustomChallenge(input: { username: string; session: string; answer: string }): Promise<CognitoCustomAuthResult>
  getUser(accessToken: string): Promise<CognitoPrincipal>
  globalSignOut(accessToken: string): Promise<void>
}

type PhoneLinkAdmin = {
  findPhoneLoginUser(phoneNumber: string): Promise<PhoneLoginUser | null>
  createPhoneUser(input: { phoneNumber: string; fullName: string }): Promise<{ username: string }>
  markPhoneVerified(username: string): Promise<void>
  deleteUser(username: string): Promise<void>
}

type SignedInMember = { id: string; cognitoSub: string }

type Pending = { profileId: string; username: string; phoneNumber: string; sentAt: number }

const e164 = /^\+[1-9]\d{7,14}$/
const codeSchema = z.string().trim().regex(/^\d{6}$/)

/**
 * "+91" + "98765 43210" -> "+919876543210". A number typed with its own leading "+" (or
 * "00") wins over the chosen country code. Indian numbers typed with a leading 0 are fine.
 */
export function composePhoneNumber(countryCode: string | null | undefined, localNumber: string | null | undefined): string | null {
  const typed = (localNumber ?? '').trim()
  if (!typed || typed.length > 30 || /[^0-9+\s().-]/.test(typed)) return null
  const digits = typed.replace(/\D/g, '')
  if (typed.startsWith('+') || typed.startsWith('00')) {
    const full = `+${digits.replace(/^00/, '')}`
    return e164.test(full) ? full : null
  }
  const code = (countryCode ?? '').trim().replace(/[^\d+]/g, '')
  if (!/^\+[1-9]\d{0,3}$/.test(code)) return null
  const national = digits.replace(/^0+/, '')
  const full = `${code}${national}`
  if (!e164.test(full)) return null
  if (code === '+91' && !/^[6-9]\d{9}$/.test(national)) return null
  return full
}

/** "+919876543210" -> "+91 98765 43210"; other numbers keep their digits after the +. */
export function displayPhoneNumber(phoneNumber: string) {
  const indian = /^\+91(\d{5})(\d{5})$/.exec(phoneNumber)
  if (indian) return `+91 ${indian[1]} ${indian[2]}`
  return phoneNumber
}

function isThrottled(error: unknown) {
  return error instanceof CognitoApiError
    && (error.code === 'TooManyRequestsException' || error.code === 'LimitExceededException')
}

function phoneIdentities(identities: SignInIdentity[]) {
  return identities.filter((identity) => identity.phoneNumber && identity.phoneNumberVerified)
}

/** A sign-in that is not a mobile-only Cognito user (email/password or Google). */
function isOtherSignIn(identity: SignInIdentity) {
  return Boolean(identity.email) && !isPhoneLoginEmail(identity.email)
}

export function createPhoneLinkService(input: {
  api: PhoneLinkApi
  admin: PhoneLinkAdmin
  repository: PhoneLinkRepository
  cookieStore: CookieStore
  siteUrl: string
  allowInsecureHttpCookies?: boolean
  now?: () => Date
  log?: (message: string, details?: Record<string, unknown>) => void
}) {
  const now = input.now ?? (() => new Date())
  const log = input.log ?? ((message, details) => console.error(message, details ?? {}))
  const policy = { allowInsecureHttp: input.allowInsecureHttpCookies === true }
  const cookieOptions = { ...cognitoCookieOptions(input.siteUrl, policy), maxAge: PENDING_MAX_AGE_SECONDS }
  const sessionCookies = createCognitoCookieManager(input.cookieStore, input.siteUrl, policy)

  function readPending(profileId: string): (Pending & { session: string }) | null {
    const session = input.cookieStore.get(PHONE_LINK_COOKIES.session)?.value
    const raw = input.cookieStore.get(PHONE_LINK_COOKIES.pending)?.value
    if (!session || !raw) return null
    try {
      const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Pending>
      if (
        value.profileId !== profileId
        || typeof value.username !== 'string'
        || typeof value.phoneNumber !== 'string'
        || !e164.test(value.phoneNumber)
      ) return null
      return {
        profileId,
        username: value.username,
        phoneNumber: value.phoneNumber,
        sentAt: typeof value.sentAt === 'number' ? value.sentAt : 0,
        session,
      }
    } catch {
      return null
    }
  }

  function writePending(pending: Pending, session: string) {
    input.cookieStore.set(PHONE_LINK_COOKIES.session, session, cookieOptions)
    input.cookieStore.set(
      PHONE_LINK_COOKIES.pending,
      Buffer.from(JSON.stringify(pending), 'utf8').toString('base64url'),
      cookieOptions,
    )
  }

  function clearPending() {
    input.cookieStore.delete(PHONE_LINK_COOKIES.session)
    input.cookieStore.delete(PHONE_LINK_COOKIES.pending)
  }

  function describe(member: SignedInMember, identities: SignInIdentity[]): AccountPhone[] {
    const otherSignIns = identities.filter(isOtherSignIn)
    return phoneIdentities(identities).map((identity) => {
      const current = identity.providerSubject === member.cognitoSub
      let reason: string | null = null
      if (!isPhoneLoginEmail(identity.email)) reason = PHONE_LINK_MESSAGES.removeUnsupported
      else if (!otherSignIns.length) reason = PHONE_LINK_MESSAGES.removeOnlySignIn
      else if (current) reason = PHONE_LINK_MESSAGES.removeCurrentSession
      return {
        identityId: identity.id,
        phoneNumber: identity.phoneNumber!,
        current,
        removable: reason === null,
        removeBlockedReason: reason,
      }
    })
  }

  /** Deletes the Cognito mobile user first, then the link, so the number can never sign in to a fresh, empty profile. */
  async function removePhoneIdentity(profileId: string, identity: SignInIdentity) {
    if (identity.providerUsername) await input.admin.deleteUser(identity.providerUsername)
    await input.repository.unlinkIdentity(profileId, identity.id)
  }

  async function signOutQuietly(accessToken: string) {
    try {
      await input.api.globalSignOut(accessToken)
    } catch {
      // Best effort: the tokens were never handed to the browser.
    }
  }

  async function getSummary(member: SignedInMember): Promise<AccountPhoneSummary> {
    const identities = await input.repository.listSignInIdentities(member.id)
    return {
      phones: describe(member, identities),
      pendingPhoneNumber: readPending(member.id)?.phoneNumber ?? null,
    }
  }

  async function requestCode(member: SignedInMember, phoneNumber: string | null): Promise<PhoneLinkState> {
    if (!phoneNumber || !e164.test(phoneNumber)) {
      return { status: 'error', step: 'request', error: PHONE_LINK_MESSAGES.invalidNumber }
    }
    const fail = (error: string): PhoneLinkState => ({ status: 'error', step: 'request', error, phoneNumber })

    try {
      const identities = await input.repository.listSignInIdentities(member.id)
      if (phoneIdentities(identities).some((identity) => identity.phoneNumber === phoneNumber)) {
        return fail(PHONE_LINK_MESSAGES.alreadyYours)
      }
      const owners = await input.repository.verifiedPhoneOwners(phoneNumber)
      if (owners.some((owner) => owner !== member.id)) return fail(PHONE_LINK_MESSAGES.inUse)

      const history = await input.repository.codeRequestHistory(member.id, phoneNumber)
      if (history.lastForProfileAt) {
        const waited = Math.floor((now().getTime() - history.lastForProfileAt.getTime()) / 1000)
        if (waited < RESEND_COOLDOWN_SECONDS) return fail(PHONE_LINK_MESSAGES.cooldown(RESEND_COOLDOWN_SECONDS - Math.max(waited, 0)))
      }
      if (history.forProfileLastHour >= MAX_CODES_PER_PROFILE_PER_HOUR || history.forPhoneLastHour >= MAX_CODES_PER_NUMBER_PER_HOUR) {
        return fail(PHONE_LINK_MESSAGES.tooMany)
      }

      let username: string
      const existing = await input.admin.findPhoneLoginUser(phoneNumber)
      if (existing) {
        const linkedTo = existing.sub ? await input.repository.profileIdForSubject(existing.sub) : null
        if (linkedTo && linkedTo !== member.id) return fail(PHONE_LINK_MESSAGES.inUse)
        // A number on someone's email or Google sign-in is theirs, even if our records don't say so.
        if (!isPhoneLoginEmail(existing.email)) return fail(PHONE_LINK_MESSAGES.inUse)
        username = existing.username
      } else {
        const fullName = (await input.repository.getProfileName(member.id))?.trim()
        const created = await input.admin.createPhoneUser({
          phoneNumber,
          fullName: fullName && fullName.length >= 2 ? fullName.slice(0, 120) : 'Sea N Shore member',
        })
        username = created.username
      }

      await input.repository.recordCodeRequest(member.id, phoneNumber)
      const challenge = await input.api.startCustomAuth(username)
      if (challenge.kind !== 'challenge') return fail(PHONE_LINK_MESSAGES.sendFailed)

      writePending({ profileId: member.id, username: challenge.username, phoneNumber, sentAt: now().getTime() }, challenge.session)
      return {
        status: 'code_sent',
        phoneNumber,
        message: `We sent a 6-digit code to ${displayPhoneNumber(phoneNumber)}. It expires in a few minutes.`,
      }
    } catch (error) {
      if (isThrottled(error)) return fail(PHONE_LINK_MESSAGES.providerBusy)
      if (error instanceof Error && error.message === 'phone_identity_ambiguous') return fail(PHONE_LINK_MESSAGES.inUse)
      log('phone_link_request_failed', { name: error instanceof Error ? error.name : null, code: error instanceof CognitoApiError ? error.code : null })
      return fail(PHONE_LINK_MESSAGES.sendFailed)
    }
  }

  async function confirmCode(member: SignedInMember, rawCode: unknown): Promise<PhoneLinkState> {
    const pending = readPending(member.id)
    if (!pending) return { status: 'error', step: 'request', error: PHONE_LINK_MESSAGES.noPending }
    const code = codeSchema.safeParse(rawCode)
    const fail = (error: string, step: 'request' | 'confirm' = 'confirm'): PhoneLinkState => ({ status: 'error', step, error, phoneNumber: pending.phoneNumber })
    if (!code.success) return fail(PHONE_LINK_MESSAGES.codeFormat)

    let authentication: CognitoAuthenticationResult
    try {
      const result = await input.api.respondToCustomChallenge({
        username: pending.username,
        session: pending.session,
        answer: code.data,
      })
      if (result.kind === 'challenge') {
        writePending({ profileId: pending.profileId, username: result.username, phoneNumber: pending.phoneNumber, sentAt: pending.sentAt }, result.session)
        return fail(PHONE_LINK_MESSAGES.wrongCode)
      }
      authentication = result.authentication
    } catch (error) {
      if (error instanceof CognitoApiError && (error.code === 'NotAuthorizedException' || error.code === 'ExpiredCodeException' || error.code === 'CodeMismatchException')) {
        clearPending()
        return fail(PHONE_LINK_MESSAGES.expired, 'request')
      }
      if (isThrottled(error)) return fail(PHONE_LINK_MESSAGES.providerBusy)
      log('phone_link_confirm_failed', { code: error instanceof CognitoApiError ? error.code : null })
      return fail(PHONE_LINK_MESSAGES.verifyFailed)
    }

    try {
      const principal = await input.api.getUser(authentication.accessToken)
      if (!principal.sub || principal.phoneNumber !== pending.phoneNumber) {
        await signOutQuietly(authentication.accessToken)
        clearPending()
        return fail(PHONE_LINK_MESSAGES.expired, 'request')
      }

      const before = await input.repository.listSignInIdentities(member.id)
      await input.repository.linkPhoneIdentity({
        profileId: member.id,
        sub: principal.sub,
        username: principal.username ?? pending.username,
        email: principal.email,
        phoneNumber: pending.phoneNumber,
      }, () => input.admin.markPhoneVerified(pending.username))
      clearPending()

      // Replacing: the new number is live, so the old mobile sign-in(s) can go.
      let switchedSession = false
      for (const old of phoneIdentities(before)) {
        if (old.phoneNumber === pending.phoneNumber || old.providerSubject === principal.sub || !isPhoneLoginEmail(old.email)) continue
        try {
          if (old.providerSubject === member.cognitoSub) {
            // Signed in with the old number: carry on signed in with the new one.
            sessionCookies.setAuthentication(authentication)
            switchedSession = true
          }
          await removePhoneIdentity(member.id, old)
        } catch (error) {
          log('phone_link_old_number_cleanup_failed', { name: error instanceof Error ? error.name : null })
        }
      }
      if (!switchedSession) await signOutQuietly(authentication.accessToken)

      return { status: 'verified', phoneNumber: pending.phoneNumber, message: PHONE_LINK_MESSAGES.verified }
    } catch (error) {
      await signOutQuietly(authentication.accessToken)
      clearPending()
      if (error instanceof PhoneNumberInUseError) return fail(PHONE_LINK_MESSAGES.inUse, 'request')
      log('phone_link_store_failed', { name: error instanceof Error ? error.name : null })
      return fail(PHONE_LINK_MESSAGES.verifyFailed, 'request')
    }
  }

  async function removePhone(member: SignedInMember, identityId: unknown): Promise<PhoneLinkState> {
    const fail = (error: string): PhoneLinkState => ({ status: 'error', step: 'remove', error })
    if (typeof identityId !== 'string' || !identityId) return fail(PHONE_LINK_MESSAGES.removeNotFound)
    try {
      const identities = await input.repository.listSignInIdentities(member.id)
      const phone = describe(member, identities).find((entry) => entry.identityId === identityId)
      const identity = identities.find((entry) => entry.id === identityId)
      if (!phone || !identity) return fail(PHONE_LINK_MESSAGES.removeNotFound)
      if (!phone.removable) return fail(phone.removeBlockedReason ?? PHONE_LINK_MESSAGES.removeFailed)
      await removePhoneIdentity(member.id, identity)
      return { status: 'removed', message: PHONE_LINK_MESSAGES.removed }
    } catch (error) {
      log('phone_link_remove_failed', { name: error instanceof Error ? error.name : null })
      return fail(PHONE_LINK_MESSAGES.removeFailed)
    }
  }

  return {
    getSummary,
    requestCode,
    confirmCode,
    removePhone,
    cancel(): PhoneLinkState {
      clearPending()
      return { status: 'idle' }
    },
  }
}

export type PhoneLinkService = ReturnType<typeof createPhoneLinkService>
