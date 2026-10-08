import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/env', () => ({ getCognitoEnvironment: () => ({ AWS_COGNITO_GOOGLE_ENABLED: false }) }))
vi.mock('@/features/auth/legacy-claim', () => ({ LEGACY_CLAIM_EMAIL_COOKIE: 'sns_legacy_claim_email' }))
vi.mock('@/features/auth/actions', () => ({
  signUp: vi.fn(async () => ({})),
  confirmSignUp: vi.fn(async () => ({})),
  resendConfirmationCode: vi.fn(async () => undefined),
}))

import SignUpPage from './page'

afterEach(() => cleanup())

const ALERT_CLASSES = 'mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700'

describe('/auth/sign-up resend notices (Round 14, 2.6)', () => {
  it('keeps the existing resend error notice for ?resendError=1', async () => {
    render(await SignUpPage({ searchParams: Promise.resolve({ confirm: '1', email: 'captain@example.com', resendError: '1' }) }))
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('We could not resend the confirmation code. Please try again shortly.')
    expect(alert.className).toBe(ALERT_CLASSES)
  })

  it('shows the rate-limit message in the same element for ?resendError=limited', async () => {
    render(await SignUpPage({ searchParams: Promise.resolve({ confirm: '1', email: 'captain@example.com', resendError: 'limited' }) }))
    const alert = screen.getByRole('alert')
    expect(alert.tagName).toBe('P')
    expect(alert).toHaveTextContent('Too many attempts. Please wait a while and try again.')
    expect(alert.className).toBe(ALERT_CLASSES)
  })

  it('shows no resend notice for unknown values', async () => {
    render(await SignUpPage({ searchParams: Promise.resolve({ confirm: '1', email: 'captain@example.com', resendError: 'other' }) }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
