import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ submit: vi.fn() }))

vi.mock('../actions', () => ({ submitContactForm: mocks.submit }))

import { ContactForm } from './contact-form'

beforeEach(() => vi.clearAllMocks())
afterEach(() => cleanup())

describe('ContactForm (round H, H7)', () => {
  it('labels every field and lists the topics', () => {
    render(<ContactForm />)
    for (const label of ['Your name', 'Email address', 'Topic', 'Message']) expect(screen.getByLabelText(label)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Account and sign-in (including a lost two-step verification device)' })).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toHaveAttribute('aria-describedby', expect.stringContaining('message-hint'))
  })

  it('links each server error to its field, summarises them and focuses the first', async () => {
    mocks.submit.mockResolvedValue({
      status: 'error',
      message: 'Please fix the highlighted fields and try again.',
      fieldErrors: { email: 'Enter a valid email address, like name@example.com.', message: 'Write your message.' },
      values: { name: 'Placeholder Sender', email: 'nope', topic: 'account', message: '' },
    })
    render(<ContactForm />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    })

    const email = screen.getByLabelText('Email address')
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'))
    const errorId = email.getAttribute('aria-describedby')!
    expect(document.getElementById(errorId)).toHaveTextContent('Enter a valid email address, like name@example.com.')
    expect(screen.getByRole('alert')).toHaveTextContent('Please correct the highlighted information')
    expect(screen.getByLabelText('Your name')).toHaveValue('Placeholder Sender')
    expect(screen.getByLabelText('Topic')).toHaveValue('account')
    await waitFor(() => expect(document.activeElement).toBe(email))
  })

  it('shows a rate-limit message in the summary when no field is wrong', async () => {
    mocks.submit.mockResolvedValue({ status: 'error', message: 'You have sent several messages in a short time.', values: { name: 'Placeholder Sender', email: 'sender@example.com', topic: 'other', message: 'Placeholder message text' } })
    render(<ContactForm />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('You have sent several messages in a short time.'))
    expect(screen.getByLabelText('Message')).toHaveValue('Placeholder message text')
  })

  it('confirms a sent message and links a member’s request', async () => {
    mocks.submit.mockResolvedValue({ status: 'success', message: 'Thanks, your message has been sent (reference SNS-33333333).', ticketId: '33333333-3333-4333-8333-333333333333', reference: 'SNS-33333333' })
    render(<ContactForm signedIn defaultName="Placeholder Sender" defaultEmail="sender@example.com" />)
    expect(screen.getByText('Your account email. You can change it.')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Message sent'))
    expect(screen.getByRole('link', { name: 'Open my request' })).toHaveAttribute('href', '/help/requests/33333333-3333-4333-8333-333333333333')
    fireEvent.click(screen.getByRole('button', { name: 'Send another message' }))
    expect(screen.getByLabelText('Your name')).toHaveValue('Placeholder Sender')
  })
})
