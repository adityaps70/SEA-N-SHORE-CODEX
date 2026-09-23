import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PhoneAuthForm } from './phone-auth-form'

const action = vi.fn(async () => ({}))

describe('PhoneAuthForm', () => {
  it('asks for full name when creating a profile with a mobile number', () => {
    render(
      <PhoneAuthForm
        intent="sign-up"
        step="request"
        requestAction={action}
        confirmAction={action}
      />,
    )

    expect(screen.getByLabelText(/full name/i)).toBeVisible()
    expect(screen.getByLabelText(/mobile number/i)).toBeVisible()
    expect(screen.getByRole('button', { name: /send verification code/i })).toBeVisible()
  })

  it('does not ask for full name when signing in with an existing mobile number', () => {
    render(
      <PhoneAuthForm
        intent="sign-in"
        step="request"
        requestAction={action}
        confirmAction={action}
      />,
    )

    expect(screen.queryByLabelText(/full name/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/mobile number/i)).toBeVisible()
  })

  it('shows a six digit OTP field during confirmation', () => {
    render(
      <PhoneAuthForm
        intent="sign-in"
        step="confirm"
        requestAction={action}
        confirmAction={action}
      />,
    )

    const code = screen.getByLabelText(/verification code/i)
    expect(code).toHaveAttribute('inputmode', 'numeric')
    expect(code).toHaveAttribute('maxlength', '6')
    expect(screen.getByRole('button', { name: /verify and continue/i })).toBeVisible()
  })
})
