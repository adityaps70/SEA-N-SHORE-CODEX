import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthMethodLinks } from './auth-method-links'

afterEach(() => cleanup())

describe('alternative authentication methods', () => {
  it('offers Google alongside existing sign-in, and no longer mobile OTP', () => {
    render(<AuthMethodLinks intent="sign-in" />)

    expect(screen.getByRole('link', { name: /continue with google/i })).toHaveAttribute(
      'href',
      '/auth/google/start?intent=sign-in',
    )
    expect(screen.queryByRole('link', { name: /continue with mobile number/i })).not.toBeInTheDocument()
    expect(document.querySelector('a[href^="/auth/phone"]')).toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('renders nothing at all when Google is not configured (no orphan "or continue with" heading)', () => {
    const { container } = render(<AuthMethodLinks intent="sign-in" googleEnabled={false} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText('or continue with')).not.toBeInTheDocument()
  })

  it('renders nothing above the form either when Google is not configured (no orphan "or" divider)', () => {
    const { container } = render(<AuthMethodLinks intent="sign-in" placement="above" googleEnabled={false} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('separator', { name: 'or' })).not.toBeInTheDocument()
  })

  it('preserves sign-up intent for Google', () => {
    render(<AuthMethodLinks intent="sign-up" />)

    expect(screen.getByRole('link', { name: /continue with google/i })).toHaveAttribute(
      'href',
      '/auth/google/start?intent=sign-up',
    )
    expect(screen.queryByRole('link', { name: /continue with mobile number/i })).not.toBeInTheDocument()
  })

  it('offers a large phone-only Google button and an "or" divider when placed above the form', () => {
    const { container } = render(<AuthMethodLinks intent="sign-in" placement="above" />)

    const group = container.firstElementChild as HTMLElement
    expect(group).toHaveClass('md:hidden')
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Continue with Google'])
    for (const link of links) expect(link).toHaveClass('w-full', 'rounded-full', 'min-h-13')
    expect(screen.getByRole('separator', { name: 'or' })).toBeInTheDocument()
  })

  it('keeps the default row below the form for desktop only', () => {
    const { container } = render(<AuthMethodLinks intent="sign-in" />)
    expect(container.firstElementChild).toHaveClass('max-md:hidden')
    expect(screen.getByText('or continue with')).toBeInTheDocument()
  })
})
