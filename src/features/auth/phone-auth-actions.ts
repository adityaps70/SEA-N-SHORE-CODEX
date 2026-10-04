import { z } from 'zod'
import { CognitoApiError, type CognitoCustomAuthResult } from '@/lib/auth/cognito-api'
import {
  COGNITO_COOKIE_NAMES,
  createCognitoCookieManager,
} from '@/lib/auth/cognito-cookies'

export type PhoneAuthActionState = {
  error?: string
  message?: string
  next?: 'confirm-phone'
}

type CookieStore = {
  get(name: string): { name: string; value: string } | undefined
  set(name: string, value: string, options?: Record<string, unknown>): void
  delete(name: string): void
}

type PhoneAuthApi = {
  startCustomAuth(username: string): Promise<CognitoCustomAuthResult>
  respondToCustomChallenge(input: {
    username: string
    session: string
    answer: string
  }): Promise<CognitoCustomAuthResult>
}

type PhoneAuthAdmin = {
  findUserByPhone(phoneNumber: string): Promise<{ username: string; verified: boolean } | null>
  createPhoneUser(input: { phoneNumber: string; fullName: string }): Promise<{ username: string }>
  markPhoneVerified(username: string): Promise<void>
}

const phoneSchema = z.string().trim().regex(/^\+[1-9]\d{7,14}$/)
const requestSchema = z.object({
  intent: z.enum(['sign-in', 'sign-up']),
  phoneNumber: phoneSchema,
  fullName: z.string().trim().min(2).max(120).optional(),
})
const otpSchema = z.string().trim().regex(/^\d{6}$/)

const GENERIC_SEND_ERROR =
  'We could not send a verification code. Check the number or create an account.'

export const PHONE_OTP_MESSAGES = {
  countryNotAllowed: 'Mobile sign-in is available for Indian (+91) numbers for now. Please continue with email or Google.',
  cooldown: 'Please wait a minute before asking for another code.',
  tooMany: 'Too many codes were requested. Please wait an hour and try again, or continue with email or Google.',
  tooManyFromNetwork: 'Too many codes were requested from this network today. Please try again tomorrow, or continue with email or Google.',
  busy: 'Our text message service is busy right now. Please wait a few minutes and try again.',
} as const

/** Calling codes (digits after "+") allowed for mobile sign-in, e.g. ["91"]. */
export function parseAllowedCallingCodes(raw: string | null | undefined): string[] {
  const codes = String(raw ?? '91').split(',').map((code) => code.trim().replace(/^\+/, '')).filter((code) => /^\d{1,3}$/.test(code))
  return codes.length ? codes : ['91']
}

function refusalMessage(error: unknown): string | null {
  if (!(error instanceof CognitoApiError)) return null
  switch (error.reason) {
    case 'otp_cooldown': return PHONE_OTP_MESSAGES.cooldown
    case 'otp_rate_limited': return PHONE_OTP_MESSAGES.tooMany
    case 'otp_country_not_allowed': return PHONE_OTP_MESSAGES.countryNotAllowed
    case 'otp_limiter_unavailable': return PHONE_OTP_MESSAGES.busy
    default: return null
  }
}

function isRetryableCognitoError(error: unknown) {
  return error instanceof CognitoApiError
    && (
      error.code === 'TooManyRequestsException'
      || error.code === 'LimitExceededException'
      || error.code === 'NotAuthorizedException'
      || error.code === 'UserNotFoundException'
    )
}

export function createPhoneAuthActions(input: {
  api: PhoneAuthApi
  admin: PhoneAuthAdmin
  cookieStore: CookieStore
  siteUrl: string
  allowInsecureHttpCookies?: boolean
  allowedCallingCodes?: string[]
  clientIp?: string | null
  ipLimiter?: { consume(ip: string | null): Promise<boolean> }
}) {
  const allowedCallingCodes = input.allowedCallingCodes ?? ['91']
  const cookies = createCognitoCookieManager(input.cookieStore, input.siteUrl, {
    allowInsecureHttp: input.allowInsecureHttpCookies === true,
  })

  async function beginChallenge(username: string): Promise<PhoneAuthActionState> {
    const result = await input.api.startCustomAuth(username)
    if (result.kind !== 'challenge') {
      return { error: GENERIC_SEND_ERROR }
    }

    cookies.setPhoneChallenge({
      session: result.session,
      username: result.username,
    })
    return {
      message: 'Verification code sent.',
      next: 'confirm-phone',
    }
  }

  return {
    async requestOtp(
      _state: PhoneAuthActionState,
      formData: FormData,
    ): Promise<PhoneAuthActionState> {
      const parsed = requestSchema.safeParse(Object.fromEntries(formData))
      if (!parsed.success) {
        return {
          error: 'Enter a valid mobile number with country code, for example +919876543210.',
        }
      }

      if (!allowedCallingCodes.some((code) => parsed.data.phoneNumber.startsWith('+' + code))) {
        return { error: PHONE_OTP_MESSAGES.countryNotAllowed }
      }
      if (input.ipLimiter && !await input.ipLimiter.consume(input.clientIp ?? null)) {
        return { error: PHONE_OTP_MESSAGES.tooManyFromNetwork }
      }

      try {
        const existing = await input.admin.findUserByPhone(parsed.data.phoneNumber)
        if (parsed.data.intent === 'sign-in') {
          if (!existing?.verified) return { error: GENERIC_SEND_ERROR }
          return await beginChallenge(existing.username)
        }

        if (existing) return await beginChallenge(existing.username)

        const fullName = parsed.data.fullName?.trim()
        if (!fullName || fullName.length < 2) {
          return { error: 'Enter your full name to create an account.' }
        }

        const created = await input.admin.createPhoneUser({
          phoneNumber: parsed.data.phoneNumber,
          fullName,
        })
        return await beginChallenge(created.username)
      } catch (error) {
        const refused = refusalMessage(error)
        if (refused) return { error: refused }
        if (isRetryableCognitoError(error)) return { error: GENERIC_SEND_ERROR }
        return { error: 'We could not send a verification code. Please try again.' }
      }
    },

    async confirmOtp(
      _state: PhoneAuthActionState,
      formData: FormData,
    ): Promise<PhoneAuthActionState> {
      const parsed = otpSchema.safeParse(formData.get('code'))
      if (!parsed.success) {
        return {
          error: 'Enter the 6-digit verification code.',
          next: 'confirm-phone',
        }
      }

      const session = input.cookieStore.get(COGNITO_COOKIE_NAMES.phoneChallenge)?.value
      const username = input.cookieStore.get(COGNITO_COOKIE_NAMES.phoneChallengeUser)?.value
      if (!session || !username) {
        return { error: 'Your verification session expired. Request a new code.' }
      }

      try {
        const result = await input.api.respondToCustomChallenge({
          username,
          session,
          answer: parsed.data,
        })

        if (result.kind === 'challenge') {
          cookies.setPhoneChallenge({
            session: result.session,
            username: result.username,
          })
          return {
            error: 'That code is incorrect or expired. Try again.',
            next: 'confirm-phone',
          }
        }

        await input.admin.markPhoneVerified(username)
        cookies.clearPhoneChallenge()
        cookies.setAuthentication(result.authentication)
        return { message: 'Signed in.' }
      } catch (error) {
        if (isRetryableCognitoError(error)) {
          return {
            error: 'That code is incorrect or expired. Try again.',
            next: 'confirm-phone',
          }
        }
        return { error: 'We could not verify the code. Please try again.' }
      }
    },
  }
}
