import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { AFTER_SIGN_OUT_COOKIE, afterSignOutRedirect } from './after-sign-out'

function request(path: string, cookie?: string) {
  return new NextRequest(new URL(path, 'https://seanshore.in'), {
    headers: cookie ? { cookie: `${AFTER_SIGN_OUT_COOKIE}=${encodeURIComponent(cookie)}` } : {},
  })
}

describe('afterSignOutRedirect', () => {
  it('sends the site root to sign-up once after "Use a different email" and clears the cookie', () => {
    const response = afterSignOutRedirect(request('/', '/auth/sign-up'))
    expect(response?.status).toBe(307)
    expect(response?.headers.get('location')).toBe('https://seanshore.in/auth/sign-up')
    expect(response?.headers.get('set-cookie')).toContain(`${AFTER_SIGN_OUT_COOKIE}=;`)
  })

  it('does nothing without the cookie or away from the root', () => {
    expect(afterSignOutRedirect(request('/'))).toBeNull()
    expect(afterSignOutRedirect(request('/pricing', '/auth/sign-up'))).toBeNull()
  })

  it('never follows an unexpected destination (no open redirect) but still clears the cookie', () => {
    const response = afterSignOutRedirect(request('/', 'https://evil.example'))
    expect(response?.headers.get('location')).toBeNull()
    expect(response?.headers.get('set-cookie')).toContain(`${AFTER_SIGN_OUT_COOKIE}=;`)
  })
})
