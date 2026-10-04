import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ cookies: {} as Record<string, string>, confirmSignInMfa: vi.fn(async () => ({})) }))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.cookies[name] ? { name, value: mocks.cookies[name] } : undefined),
  }),
}))
vi.mock('@/features/auth/actions', () => ({ confirmSignInMfa: mocks.confirmSignInMfa }))

import MfaSignInPage from './page'

beforeEach(() => {
  mocks.cookies = {}
})
afterEach(() => cleanup())

describe('/auth/mfa (Round 14, 2.11)', () => {
  it('asks for the 6-digit authenticator code in the standard auth form, without exposing the session', async () => {
    mocks.cookies = { sns_cognito_mfa_challenge: 'opaque-session-value', sns_cognito_mfa_challenge_user: 'internal-user-1' }
    const { container } = render(await MfaSignInPage())

    expect(screen.getByRole('heading', { name: 'Enter your authenticator code' })).toBeInTheDocument()
    const code = screen.getByLabelText('Authenticator code')
    expect(code).toHaveAttribute('name', 'code')
    expect(code).toHaveAttribute('inputmode', 'numeric')
    expect(code).toHaveAttribute('autocomplete', 'one-time-code')
    expect(code).toHaveAttribute('maxlength', '6')
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verify and sign in' })).toBeEnabled()
    expect(container.innerHTML).not.toContain('opaque-session-value')
    expect(container.innerHTML).not.toContain('internal-user-1')
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/auth/sign-in')
  })

  it('explains an expired sign-in session and links back to sign in', async () => {
    render(await MfaSignInPage())

    expect(screen.getByRole('alert')).toHaveTextContent('Your sign-in session expired. Please sign in again.')
    expect(screen.queryByLabelText('Authenticator code')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/auth/sign-in')
  })
})
