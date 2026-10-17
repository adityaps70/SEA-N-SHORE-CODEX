import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TicketReplyForm } from './ticket-reply-form'

afterEach(() => cleanup())

describe('TicketReplyForm (round H, H7)', () => {
  it('links the error to the field, keeps the text and focuses the field', async () => {
    const action = vi.fn(async () => ({ status: 'error' as const, fieldError: 'Write your reply.', body: '' }))
    render(<TicketReplyForm action={action} label="Your reply" hint="We answer by email and here." submitLabel="Send reply" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    })
    const field = screen.getByLabelText('Your reply')
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
    const ids = field.getAttribute('aria-describedby')!.split(' ')
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual(['Write your reply.', 'We answer by email and here.'])
    await waitFor(() => expect(document.activeElement).toBe(field))
  })

  it('announces a sent reply and clears the box', async () => {
    const action = vi.fn(async () => ({ status: 'success' as const, message: 'Your reply has been sent.' }))
    render(<TicketReplyForm action={action} label="Your reply" submitLabel="Send reply" />)
    fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'Placeholder reply' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Your reply has been sent.'))
    expect(screen.getByLabelText('Your reply')).toHaveValue('')
  })
})
