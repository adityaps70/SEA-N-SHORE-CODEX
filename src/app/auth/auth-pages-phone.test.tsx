import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ googleEnabled: true }))

vi.mock('@/lib/env', () => ({
  getCognitoEnvironment: () => ({ AWS_COGNITO_GOOGLE_ENABLED: mocks.googleEnabled }),
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

beforeEach(() => {
  mocks.googleEnabled = true
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

describe('/auth/sign-in on phones', () => {
  it('puts Google and mobile number above the email form, then the form, forgot password, Sign in and Join now', async () => {
    const { container } = render(await SignInPage({ searchParams: Promise.resolve({}) }))

    expect(phoneOrder(container)).toEqual([
      'Sea N Shore home',
      'Continue with Google',
      'Continue with mobile number',
      'Email',
      'Password',
      'Show password',
      'Forgot password?',
      'Sign in',
      'Join now',
    ])

    const above = container.querySelector('[data-auth-methods="above"]') as HTMLElement
    expect(above).toHaveClass('md:hidden')
    expect(within(above).getByRole('link', { name: /Continue with Google/ })).toHaveAttribute('href', '/auth/google/start?intent=sign-in')
    expect(within(above).getByRole('link', { name: /Continue with mobile number/ })).toHaveAttribute('href', '/auth/phone?intent=sign-in')
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
      'Continue with mobile number',
      'Continue with Google',
      'Create your profile',
      'Forgot password?',
    ])
  })

  it('leaves Google out on phones too when it is switched off', async () => {
    mocks.googleEnabled = false
    const { container } = render(await SignInPage({ searchParams: Promise.resolve({}) }))
    expect(phoneOrder(container).slice(1, 3)).toEqual(['Continue with mobile number', 'Email'])
    expect(screen.queryByRole('link', { name: /Continue with Google/ })).not.toBeInTheDocument()
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

describe('/auth/sign-up on phones', () => {
  it('uses the same order: Google, mobile number, then the email form', async () => {
    const { container } = render(await SignUpPage({ searchParams: Promise.resolve({}) }))
    expect(phoneOrder(container)).toEqual([
      'Sea N Shore home',
      'Continue with Google',
      'Continue with mobile number',
      'Full name',
      'Email',
      'Password',
      'Show password',
      'Create account',
      'Sign in',
    ])
    const above = container.querySelector('[data-auth-methods="above"]') as HTMLElement
    expect(within(above).getByRole('link', { name: /Continue with mobile number/ })).toHaveAttribute('href', '/auth/phone?intent=sign-up')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password')
  })
})

describe('/auth/phone on phones', () => {
  it('opens the phone keypad for the number and the one-time code field for the code', async () => {
    const request = render(await PhoneAuthPage({ searchParams: Promise.resolve({ intent: 'sign-in' }) }))
    const phone = screen.getByLabelText('Mobile number')
    expect(phone).toHaveAttribute('type', 'tel')
    expect(phone).toHaveAttribute('inputmode', 'tel')
    expect(phone).toHaveAttribute('autocomplete', 'tel')
    request.unmount()

    render(await PhoneAuthPage({ searchParams: Promise.resolve({ intent: 'sign-in', step: 'confirm' }) }))
    const code = screen.getByLabelText('Verification code')
    expect(code).toHaveAttribute('inputmode', 'numeric')
    expect(code).toHaveAttribute('autocomplete', 'one-time-code')
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
