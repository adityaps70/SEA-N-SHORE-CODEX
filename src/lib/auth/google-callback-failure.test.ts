import { describe, expect, it, vi } from 'vitest'
import { googleCallbackFailure, logGoogleCallbackFailure } from './google-callback-failure'

const ok = { providerError: null, code: 'abc', verifier: 'v', stateMatches: true }

describe('googleCallbackFailure', () => {
  it('names why a Google callback has no session, and nothing when it is fine', () => {
    expect(googleCallbackFailure(ok)).toBeNull()
    expect(googleCallbackFailure({ ...ok, providerError: 'access_denied' })).toBe('provider_access_denied')
    expect(googleCallbackFailure({ ...ok, code: null })).toBe('missing_code')
    expect(googleCallbackFailure({ ...ok, verifier: undefined })).toBe('missing_verifier')
    expect(googleCallbackFailure({ ...ok, stateMatches: false })).toBe('state_mismatch')
  })

  it('never passes provider text through unless it is a plain OAuth error code', () => {
    expect(googleCallbackFailure({ ...ok, providerError: 'someone@example.com' })).toBe('provider_other')
    expect(googleCallbackFailure({ ...ok, providerError: 'invalid_request&x=1' })).toBe('provider_other')
  })
})

describe('logGoogleCallbackFailure', () => {
  it('logs the provider and reason only', () => {
    const warn = vi.fn()
    logGoogleCallbackFailure('exchange_failed', warn)
    expect(warn).toHaveBeenCalledWith('[auth_callback_failed]', { provider: 'google', reason: 'exchange_failed' })
  })
})
