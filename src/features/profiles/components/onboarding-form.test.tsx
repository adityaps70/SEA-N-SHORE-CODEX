import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../actions', () => ({
  completeActivation: vi.fn(async () => ({ revision: 0 })),
}))

import { OnboardingForm } from './onboarding-form'

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
    expect(screen.getByLabelText('Profile address')).toBeInTheDocument()
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
})
