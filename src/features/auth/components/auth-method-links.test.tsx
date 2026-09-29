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

  it('offers large phone-only buttons with Google first and an "or" divider when placed above the form', () => {
    const { container } = render(<AuthMethodLinks intent="sign-in" placement="above" />)

    const group = container.firstElementChild as HTMLElement
    expect(group).toHaveClass('md:hidden')
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Continue with Google', 'Continue with mobile number'])
    for (const link of links) expect(link).toHaveClass('w-full', 'rounded-full', 'min-h-13')
    expect(screen.getByRole('separator', { name: 'or' })).toBeInTheDocument()
  })

  it('keeps the default row below the form for desktop only', () => {
    const { container } = render(<AuthMethodLinks intent="sign-in" />)
    expect(container.firstElementChild).toHaveClass('max-md:hidden')
    expect(screen.getByText('or continue with')).toBeInTheDocument()
  })
})
