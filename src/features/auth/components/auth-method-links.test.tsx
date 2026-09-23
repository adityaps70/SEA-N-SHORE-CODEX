import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthMethodLinks } from './auth-method-links'

afterEach(() => cleanup())

describe('alternative authentication methods', () => {
  it('offers mobile OTP and Google alongside existing sign-in', () => {
    render(<AuthMethodLinks intent="sign-in" />)

    expect(screen.getByRole('link', { name: /continue with mobile number/i })).toHaveAttribute(
      'href',
      '/auth/phone?intent=sign-in',
    )
    expect(screen.getByRole('link', { name: /continue with google/i })).toHaveAttribute(
      'href',
      '/auth/google/start?intent=sign-in',
    )
  })

  it('hides Google when federation is not configured yet', () => {
    render(<AuthMethodLinks intent="sign-in" googleEnabled={false} />)

    expect(screen.getByRole('link', { name: /continue with mobile number/i })).toBeVisible()
    expect(screen.queryByRole('link', { name: /continue with google/i })).not.toBeInTheDocument()
  })

  it('preserves sign-up intent for the same providers', () => {
    render(<AuthMethodLinks intent="sign-up" />)

    expect(screen.getByRole('link', { name: /continue with mobile number/i })).toHaveAttribute(
      'href',
      '/auth/phone?intent=sign-up',
    )
    expect(screen.getByRole('link', { name: /continue with google/i })).toHaveAttribute(
      'href',
      '/auth/google/start?intent=sign-up',
    )
  })
})
