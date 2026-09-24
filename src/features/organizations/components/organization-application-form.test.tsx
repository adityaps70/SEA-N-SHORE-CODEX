import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  submitOrganizationApplication: vi.fn(),
  resubmitOrganizationApplication: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock('../actions', () => ({
  submitOrganizationApplication: mocks.submitOrganizationApplication,
  resubmitOrganizationApplication: mocks.resubmitOrganizationApplication,
}))

import { OrganizationApplicationForm } from './organization-application-form'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => cleanup())

describe('OrganizationApplicationForm onboarding errors', () => {
  it('shows a field-level corrective error, keeps entered data, and focuses the invalid field', async () => {
    mocks.submitOrganizationApplication.mockResolvedValueOnce({
      ok: false,
      error: 'Please correct the highlighted information and try again.',
      fieldErrors: {
        officialEmail: ['Enter a valid work email address, for example name@company.com.'],
      },
    })

    render(<OrganizationApplicationForm mode="create" />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Organization name' }), {
      target: { value: 'Oceanic Shipping' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Official company email' }), {
      target: { value: 'not-an-email' },
    })

    const form = screen.getByRole('button', { name: 'Submit for verification' }).closest('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form!)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Please correct the highlighted information')
    expect(screen.getByText('Enter a valid work email address, for example name@company.com.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Organization name' })).toHaveValue('Oceanic Shipping')
    expect(screen.getByRole('textbox', { name: 'Official company email' })).toHaveValue('not-an-email')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Official company email' })))
  })

  it('turns an unexpected submit rejection into a visible retry message without clearing the form', async () => {
    mocks.submitOrganizationApplication.mockRejectedValueOnce(new Error('network unavailable'))
    render(<OrganizationApplicationForm mode="create" />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Organization name' }), {
      target: { value: 'Oceanic Shipping' },
    })

    const form = screen.getByRole('button', { name: 'Submit for verification' }).closest('form')
    fireEvent.submit(form!)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/check your connection and try again/i)
    expect(screen.getByRole('textbox', { name: 'Organization name' })).toHaveValue('Oceanic Shipping')
  })
})
