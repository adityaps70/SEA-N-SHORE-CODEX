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

export {
  PHONE_LINK_COOKIES,
  RESEND_COOLDOWN_SECONDS,
  MAX_CODES_PER_PROFILE_PER_HOUR,
  MAX_CODES_PER_NUMBER_PER_HOUR,
  PHONE_LINK_MESSAGES,
  composePhoneNumber,
  displayPhoneNumber,
  type PhoneLinkState,
  type AccountPhone,
  type AccountPhoneSummary,
} from './phone-link-shared'
import {
  PHONE_LINK_COOKIES,
  RESEND_COOLDOWN_SECONDS,
  MAX_CODES_PER_PROFILE_PER_HOUR,
  MAX_CODES_PER_NUMBER_PER_HOUR,
  PHONE_LINK_MESSAGES,
  E164_PHONE_PATTERN,
  displayPhoneNumber,
  type PhoneLinkState,
  type AccountPhone,
  type AccountPhoneSummary,
} from './phone-link-shared'

const PENDING_MAX_AGE_SECONDS = 10 * 60

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

const codeSchema = z.string().trim().regex(/^\d{6}$/)

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
        || !E164_PHONE_PATTERN.test(value.phoneNumber)
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
    if (!phoneNumber || !E164_PHONE_PATTERN.test(phoneNumber)) {
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
