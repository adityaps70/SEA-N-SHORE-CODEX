import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthMethodLinks } from './auth-method-links'

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
