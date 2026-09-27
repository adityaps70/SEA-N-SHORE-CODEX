import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ subscribe: vi.fn() }))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
}))
vi.mock('../actions', () => ({ subscribeToNewsletter: mocks.subscribe }))

import { NewsletterSignupForm } from './newsletter-signup-form'

beforeEach(() => vi.clearAllMocks())
afterEach(() => cleanup())

describe('NewsletterSignupForm', () => {
  it('prefills the signed-in member email but never submits or ticks consent on its own', () => {
    render(<NewsletterSignupForm defaultEmail="crew@example.com" />)

    expect(screen.getByLabelText('Email address')).toHaveValue('crew@example.com')
    expect(screen.getByText('This is your account email. You can change it.')).toBeInTheDocument()
    const consent = screen.getByRole('checkbox', { name: /Yes, email me the Sea N Shore newsletter/ })
    expect(consent).not.toBeChecked()
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
    expect(screen.getByRole('group', { name: 'Topics' })).toBeInTheDocument()
    expect(mocks.subscribe).not.toHaveBeenCalled()
  })

  it('shows field errors from the server and keeps the consent tick the person gave', async () => {
    mocks.subscribe.mockResolvedValue({
      status: 'error',
      message: 'Please fix the highlighted fields and try again.',
      fieldErrors: { email: 'Enter a valid email address, like name@example.com.' },
      values: { email: 'nope', topics: ['product_updates'], consent: true },
    })
    render(<NewsletterSignupForm />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    })

    await waitFor(() => expect(screen.getByText('Enter a valid email address, like name@example.com.')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('Please fix the highlighted fields')
    expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('checkbox', { name: /Yes, email me/ })).toBeChecked()
  })

  it('replaces the form with a clear success state', async () => {
    mocks.subscribe.mockResolvedValue({
      status: 'success',
      outcome: 'confirmation_required',
      message: 'Almost done: we sent a confirmation link to crew@example.com.',
      values: { email: 'crew@example.com', topics: ['product_updates'] },
    })
    render(<NewsletterSignupForm />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    })

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Check your inbox'))
    expect(mocks.subscribe).toHaveBeenCalledTimes(1)
    const formData = mocks.subscribe.mock.calls[0][1] as FormData
    expect(formData.get('source')).toBe('newsletter_page')

    fireEvent.click(screen.getByRole('button', { name: 'Use a different email address' }))
    expect(screen.getByRole('checkbox', { name: /Yes, email me/ })).not.toBeChecked()
  })
})
