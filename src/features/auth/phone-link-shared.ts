/**
 * Client-safe pieces of Settings > Mobile number (constants, messages, types and number
 * formatting). Kept apart from phone-link.ts, which pulls in Cognito and the database,
 * so client components can import these without bundling server-only code.
 */

export const PHONE_LINK_COOKIES = {
  session: 'sns_phone_link_session',
  pending: 'sns_phone_link',
} as const

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

export const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/

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
    return E164_PHONE_PATTERN.test(full) ? full : null
  }
  const code = (countryCode ?? '').trim().replace(/[^\d+]/g, '')
  if (!/^\+[1-9]\d{0,3}$/.test(code)) return null
  const national = digits.replace(/^0+/, '')
  const full = `${code}${national}`
  if (!E164_PHONE_PATTERN.test(full)) return null
  if (code === '+91' && !/^[6-9]\d{9}$/.test(national)) return null
  return full
}

/** "+919876543210" -> "+91 98765 43210"; other numbers keep their digits after the +. */
export function displayPhoneNumber(phoneNumber: string) {
  const indian = /^\+91(\d{5})(\d{5})$/.exec(phoneNumber)
  if (indian) return `+91 ${indian[1]} ${indian[2]}`
  return phoneNumber
}
