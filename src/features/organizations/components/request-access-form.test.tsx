import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestOrganizationAccess: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('../actions', () => ({ requestOrganizationAccess: mocks.requestOrganizationAccess }))

import { RequestAccessForm } from './request-access-form'

const company = { id: '33333333-3333-4333-8333-333333333333', name: 'Harbour Minds' }

afterEach(() => cleanup())
beforeEach(() => vi.clearAllMocks())

describe('RequestAccessForm', () => {
  it('sends the request to the organization owner and admins and shows the new status', async () => {
    mocks.requestOrganizationAccess.mockResolvedValueOnce({ ok: true, requestId: 'request-1' })
    render(<RequestAccessForm company={company} />)

    fireEvent.click(screen.getByRole('button', { name: 'Request access' }))
    const role = screen.getByRole('combobox', { name: /Role you need/ })
    expect(document.activeElement).toBe(role)
    fireEvent.change(role, { target: { value: 'content_manager' } })
    expect(screen.getByText('Edit the organization page and branding.')).toBeInTheDocument()
    expect(screen.getByText(/owner and administrators of Harbour Minds decide/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: /Message to the organization/ }), { target: { value: 'I run communications.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))

    await waitFor(() => expect(mocks.requestOrganizationAccess).toHaveBeenCalledWith(company.id, 'content_manager', 'I run communications.'))
    expect(await screen.findByRole('status')).toHaveTextContent('Sent to the owner and administrators of Harbour Minds')
    expect(screen.getByText('Request waiting for a decision')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/submitted for Sea N Shore review/i)
  })

  it('keeps the form open with the server message when the request fails', async () => {
    mocks.requestOrganizationAccess.mockResolvedValueOnce({ ok: false, error: 'You are already linked to this organization.' })
    render(<RequestAccessForm company={company} />)
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You are already linked to this organization.')
    expect(screen.getByRole('combobox', { name: /Role you need/ })).toBeInTheDocument()
  })

  it('closes with Escape and returns focus to the trigger', async () => {
    render(<RequestAccessForm company={company} />)
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }))
    fireEvent.keyDown(screen.getByRole('combobox', { name: /Role you need/ }), { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Request access' })))
  })

  it('shows membership and pending states instead of the button', () => {
    const { rerender } = render(<RequestAccessForm company={company} initialState="pending" />)
    expect(screen.getByText('Request waiting for a decision')).toBeInTheDocument()
    // A refresh after approval moves the state forward.
    rerender(<RequestAccessForm company={company} initialState="member" />)
    expect(screen.getByText('You are a member')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()
  })
})
