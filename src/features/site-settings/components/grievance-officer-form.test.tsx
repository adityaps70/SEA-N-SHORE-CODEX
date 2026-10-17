import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('../admin-actions', () => ({ saveGrievanceOfficerAction: mocks.save }))

import { GrievanceOfficerForm } from './grievance-officer-form'

afterEach(() => cleanup())

describe('GrievanceOfficerForm (round H, H7)', () => {
  it('shows saved values, links errors to fields and announces a save', async () => {
    mocks.save.mockResolvedValueOnce({ status: 'error', message: 'Please fix the highlighted fields and try again.', fieldErrors: { email: 'Add the Grievance Officer’s email address, or clear the name.' }, values: { name: 'Placeholder Officer', email: '', responseTime: '' } })
    render(<GrievanceOfficerForm initial={{ name: '', email: '', responseTime: '' }} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Grievance Officer' }))
    })
    const email = screen.getByLabelText('Email address')
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'))
    expect(document.getElementById(email.getAttribute('aria-describedby')!)).toHaveTextContent('Add the Grievance Officer’s email address, or clear the name.')
    expect(screen.getByLabelText('Name')).toHaveValue('Placeholder Officer')

    mocks.save.mockResolvedValueOnce({ status: 'success', message: 'Saved. The Contact page now names the Grievance Officer.', values: { name: 'Placeholder Officer', email: 'officer@example.com', responseTime: '' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Grievance Officer' }))
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved. The Contact page now names the Grievance Officer.'))
    expect(screen.getByLabelText('Email address')).toHaveValue('officer@example.com')
  })
})
