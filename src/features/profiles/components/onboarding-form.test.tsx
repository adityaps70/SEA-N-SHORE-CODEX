import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const actionMocks = vi.hoisted(() => ({
  completeActivation: vi.fn(async () => ({ revision: 0 })),
}))

vi.mock('../actions', () => ({
  completeActivation: actionMocks.completeActivation,
}))

import { OnboardingForm } from './onboarding-form'

beforeEach(() => {
  actionMocks.completeActivation.mockReset()
  actionMocks.completeActivation.mockResolvedValue({ revision: 0 })
})

afterEach(() => cleanup())

describe('OnboardingForm exact identity activation', () => {
  it('starts with only Professional and Organisation identity roots', () => {
    render(<OnboardingForm initialFullName="Asha Singh" />)

    expect(screen.getByRole('button', { name: /Professional/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Organisation/i })).toBeInTheDocument()
    expect(screen.queryByText('Seafarer')).not.toBeInTheDocument()
    expect(screen.queryByText('Recruiter')).not.toBeInTheDocument()
  })

  it('searches and selects an exact professional identity', () => {
    render(<OnboardingForm initialFullName="Asha Singh" />)

    fireEvent.click(screen.getByRole('button', { name: /Professional/i }))
    fireEvent.change(screen.getByRole('searchbox', { name: /Search professional identities/i }), {
      target: { value: 'chief eng' },
    })

    expect(screen.getByRole('button', { name: /Chief Engineer.*Sea-going · Engine/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Chief Engineer.*Sea-going · Engine/i }))
    expect(screen.getByText('Chief Engineer', { selector: '[data-primary-identity="true"]' })).toBeInTheDocument()
  })

  it('keeps activation lightweight and provides additional/custom identity controls', () => {
    render(<OnboardingForm initialFullName="Asha Singh" />)
    fireEvent.click(screen.getByRole('button', { name: /Professional/i }))

    expect(screen.getByText(/Can.t find your role/i)).toBeInTheDocument()
    expect(screen.getByText(/Add another identity/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Username/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Location')).toBeInTheDocument()
    expect(screen.getByLabelText('Current organisation')).toBeInTheDocument()
    expect(screen.getByLabelText('Professional headline')).toBeInTheDocument()

    expect(screen.queryByLabelText('Professional summary')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Skills')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Current or most recent rank')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sailing experience in years')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Vessel types')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Trading areas')).not.toBeInTheDocument()
  })

  it('switches the lightweight details to organisation language', () => {
    render(<OnboardingForm initialFullName="Oceanic Marine" />)
    fireEvent.click(screen.getByRole('button', { name: /Organisation/i }))

    expect(screen.getByLabelText('Organisation name')).toBeInTheDocument()
    expect(screen.queryByLabelText('Current organisation')).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: /Search organisation identities/i })).toBeInTheDocument()
  })
  it('keeps Complete profile actionable so missing fields produce visible validation instead of a silent disabled button', () => {
    render(<OnboardingForm initialFullName="Asha Singh" />)

    expect(screen.getByRole('button', { name: 'Complete profile' })).toBeEnabled()
  })

  it('shows and focuses a clear error summary when the server rejects an onboarding step', async () => {
    actionMocks.completeActivation.mockResolvedValueOnce({
      revision: 1,
      fieldErrors: {
        identityRoot: ['Choose Professional or Organisation to continue.'],
      },
      values: {},
    })
    render(<OnboardingForm initialFullName="Asha Singh" />)

    const form = screen.getByRole('button', { name: 'Complete profile' }).closest('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form!)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Please correct the highlighted information')
    expect(alert).toHaveTextContent('Choose Professional or Organisation to continue.')
    await waitFor(() => expect(document.activeElement).toHaveTextContent(/I.m joining as/i))
  })

})
