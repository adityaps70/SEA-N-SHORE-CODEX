import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ googleEnabled: true, redirect: vi.fn(), claimEmail: undefined as string | undefined }))

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  redirect: mocks.redirect,
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => name === 'sns_legacy_claim_email' && mocks.claimEmail
      ? { name, value: mocks.claimEmail }
      : undefined,
  }),
}))

vi.mock('@/lib/env', () => ({
  getCognitoEnvironment: () => ({ AWS_COGNITO_GOOGLE_ENABLED: mocks.googleEnabled }),
}))
vi.mock('@/features/auth/legacy-claim-actions', () => ({
  LEGACY_CLAIM_EMAIL_COOKIE: 'sns_legacy_claim_email',
  prepareLegacyProfileClaim: vi.fn(async () => undefined),
}))
vi.mock('@/features/auth/actions', () => ({
  signIn: vi.fn(async () => ({})),
  signUp: vi.fn(async () => ({})),
  confirmSignUp: vi.fn(async () => ({})),
  resendConfirmationCode: vi.fn(async () => undefined),
  requestPasswordReset: vi.fn(async () => ({})),
  updatePassword: vi.fn(async () => ({})),
  requestPhoneOtp: vi.fn(async () => ({})),
  confirmPhoneOtp: vi.fn(async () => ({})),
}))

import SignInPage from './sign-in/page'
import SignUpPage from './sign-up/page'
import PhoneAuthPage from './phone/page'
import ForgotPasswordPage from './forgot-password/page'
import ClaimProfilePage from './claim-profile/page'

beforeEach(() => {
  mocks.googleEnabled = true
  mocks.claimEmail = undefined
  mocks.redirect.mockReset()
})
afterEach(() => cleanup())

/** Label of a control as one layout shows it (subtrees hidden in that layout are skipped). */
function shownLabel(node: HTMLElement, hiddenClass: string) {
  const label = node.getAttribute('aria-label')
  if (label) return label
  const copy = node.cloneNode(true) as HTMLElement
  for (const hidden of copy.querySelectorAll(`.${CSS.escape(hiddenClass)}, [aria-hidden="true"]`)) hidden.remove()
  return copy.textContent?.trim() ?? ''
}

/** Controls a layout shows, in document (reading and tab) order. Phones hide `max-md:hidden`; desktop hides `md:hidden`. */
function orderFor(container: HTMLElement, hiddenClass: string) {
  return [...container.querySelectorAll<HTMLElement>('a, button, input:not([type="hidden"])')]
    .filter((node) => !node.closest(`.${CSS.escape(hiddenClass)}`))
    .map((node) => shownLabel(node, hiddenClass))
}

const phoneOrder = (container: HTMLElement) => orderFor(container, 'max-md:hidden')
const desktopOrder = (container: HTMLElement) => orderFor(container, 'md:hidden')

describe('/auth/sign-in restored-profile continuation', () => {
  it('prefills the claim email while the short-lived claim cookie exists', async () => {
    mocks.claimEmail = 'legacy.member@example.com'
    render(await SignInPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByLabelText('Email')).toHaveValue('legacy.member@example.com')
    expect(screen.getByText(/Finish claiming your restored profile/i)).toBeInTheDocument()
  })
})

describe('/auth/sign-in on phones', () => {
  it('puts Google above the email form, then the form, forgot password, Sign in and Join now', async () => {
    const { container } = render(await SignInPage({ searchParams: Promise.resolve({}) }))

    expect(phoneOrder(container)).toEqual([
      'Sea N Shore home',
      'Continue with Google',
      'Email',
      'Password',
      'Show password',
      'Forgot password?',
      'Sign in',
      'Claim your restored profile',
      'Join now',
    ])

    const above = container.querySelector('[data-auth-methods="above"]') as HTMLElement
    expect(above).toHaveClass('md:hidden')
    expect(within(above).getByRole('link', { name: /Continue with Google/ })).toHaveAttribute('href', '/auth/google/start?intent=sign-in')
    expect(screen.queryByRole('link', { name: /Continue with mobile number/ })).not.toBeInTheDocument()
    expect(container.querySelector('a[href^="/auth/phone"]')).toBeNull()
    expect(within(above).getByRole('separator', { name: 'or' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Forgot password?' }).every((link) => link.getAttribute('href') === '/auth/forgot-password')).toBe(true)
    expect(screen.getByRole('link', { name: /Join now/ })).toHaveAttribute('href', '/auth/sign-up')
  })

  it('keeps the desktop order unchanged: form first, then the other methods', async () => {
    const { container } = render(await SignInPage({ searchParams: Promise.resolve({}) }))
    expect(desktopOrder(container)).toEqual([
      'Sea N Shore home',
      'Email',
      'Password',
      'Sign in',
      'Continue with Google',
      'Claim your restored profile',
      'Create your profile',
      'Forgot password?',
    ])
  })

  it('shows only the email form when Google is switched off: no other methods, no "or" divider', async () => {
    mocks.googleEnabled = false
    const { container } = render(await SignInPage({ searchParams: Promise.resolve({}) }))
    expect(phoneOrder(container).slice(1, 3)).toEqual(['Email', 'Password'])
    expect(desktopOrder(container).slice(1, 6)).toEqual(['Email', 'Password', 'Sign in', 'Claim your restored profile', 'Create your profile'])
    expect(screen.queryByRole('link', { name: /Continue with Google/ })).not.toBeInTheDocument()
    expect(container.querySelector('[data-auth-methods]')).toBeNull()
    expect(screen.queryByRole('separator', { name: 'or' })).not.toBeInTheDocument()
    expect(screen.queryByText('or continue with')).not.toBeInTheDocument()
  })

  it('uses the email keyboard and autofill for the email field', async () => {
    render(await SignInPage({ searchParams: Promise.resolve({}) }))
    const email = screen.getByLabelText('Email')
    expect(email).toHaveAttribute('type', 'email')
    expect(email).toHaveAttribute('inputmode', 'email')
    expect(email).toHaveAttribute('autocomplete', 'email')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
  })

  it('shows and hides the password with the Show / Hide toggle', async () => {
    render(await SignInPage({ searchParams: Promise.resolve({}) }))
    const password = screen.getByLabelText('Password')
    const toggle = screen.getByRole('button', { name: 'Show password' })

    expect(password).toHaveAttribute('type', 'password')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).toHaveAttribute('aria-controls', password.id)
    expect(toggle).toHaveTextContent('Show')
    expect(toggle).toHaveAttribute('type', 'button')

    fireEvent.click(toggle)
    expect(password).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveTextContent('Hide')

    fireEvent.click(toggle)
    expect(password).toHaveAttribute('type', 'password')
    // The value is still submitted under the same name.
    expect(password).toHaveAttribute('name', 'password')
  })
})

describe('/auth/claim-profile', () => {
  it('explains the restored-profile flow without revealing whether an email exists', async () => {
    const { container } = render(await ClaimProfilePage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', { name: 'Claim your restored profile' })).toBeInTheDocument()
    expect(screen.getByText(/old password was not moved/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Continue with Google/i })).toHaveAttribute(
      'href',
      '/auth/google/start?intent=sign-in',
    )
    expect(screen.getByLabelText('Old registered email')).toHaveAttribute('type', 'email')
    expect(screen.getByText(/won't confirm publicly whether an email is in the old database/i)).toBeInTheDocument()
    expect(phoneOrder(container)).toEqual([
      'Sea N Shore home',
      'Continue with Google',
      'Old registered email',
      'Continue with email',
      'Back to sign in',
    ])
  })

  it('hides Google when Google sign-in is disabled', async () => {
    mocks.googleEnabled = false
    render(await ClaimProfilePage({ searchParams: Promise.resolve({}) }))
    expect(screen.queryByRole('link', { name: /Continue with Google/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue with email' })).toBeInTheDocument()
  })
})

describe('/auth/sign-up on phones', () => {
  it('prefills the old registered email when entering from the claim flow', async () => {
    mocks.claimEmail = 'legacy.member@example.com'
    render(await SignUpPage({ searchParams: Promise.resolve({ legacy: '1' }) }))

    expect(screen.getByLabelText('Email')).toHaveValue('legacy.member@example.com')
    expect(screen.getByText(/Restored profile claim:/)).toBeInTheDocument()
  })

  it('uses the same order: Google, then the email form', async () => {
    const { container } = render(await SignUpPage({ searchParams: Promise.resolve({}) }))
    expect(phoneOrder(container)).toEqual([
      'Sea N Shore home',
      'Continue with Google',
      'Full name',
      'Email',
      'Password',
      'Show password',
      'Create account',
      'Sign in',
    ])
    const above = container.querySelector('[data-auth-methods="above"]') as HTMLElement
    expect(within(above).getByRole('link', { name: /Continue with Google/ })).toHaveAttribute('href', '/auth/google/start?intent=sign-up')
    expect(screen.queryByRole('link', { name: /Continue with mobile number/ })).not.toBeInTheDocument()
    expect(container.querySelector('a[href^="/auth/phone"]')).toBeNull()
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password')
  })
})

describe('/auth/phone', () => {
  it('no longer offers mobile-number sign-in: it sends visitors to email sign-in', () => {
    PhoneAuthPage()
    expect(mocks.redirect).toHaveBeenCalledTimes(1)
    expect(mocks.redirect).toHaveBeenCalledWith('/auth/sign-in')
  })
})

describe('auth pages share the phone frame', () => {
  it('drops the card on phones but keeps it from md up', () => {
    const { container } = render(<ForgotPasswordPage />)
    const main = container.querySelector('main') as HTMLElement
    expect(main).toHaveClass('bg-mist-50', 'max-md:bg-white')
    const card = main.querySelector('section') as HTMLElement
    expect(card).toHaveClass('shadow-[var(--shadow-card)]', 'max-md:shadow-none', 'max-md:p-0')
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/auth/sign-in')
  })
})
