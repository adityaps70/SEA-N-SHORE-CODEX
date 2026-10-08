/**
 * Why a Google sign-in came back without a session, logged with the time only: never an email,
 * user id, code or token. Shows up in the web log as [auth_callback_failed].
 */
export type GoogleCallbackFailure =
  | 'unavailable'
  | 'missing_code'
  | 'missing_verifier'
  | 'state_mismatch'
  | 'exchange_failed'
  | `provider_${string}`

export function googleCallbackFailure(input: {
  providerError: string | null
  code: string | null
  verifier: string | undefined
  stateMatches: boolean
}): GoogleCallbackFailure | null {
  if (input.providerError) {
    // OAuth error codes are short snake_case words (access_denied, server_error, …).
    return /^[a-z_]{1,40}$/.test(input.providerError) ? `provider_${input.providerError}` : 'provider_other'
  }
  if (!input.code) return 'missing_code'
  if (!input.verifier) return 'missing_verifier'
  if (!input.stateMatches) return 'state_mismatch'
  return null
}

export function logGoogleCallbackFailure(reason: GoogleCallbackFailure, warn: (tag: string, context: object) => void = console.warn) {
  warn('[auth_callback_failed]', { provider: 'google', reason })
}
