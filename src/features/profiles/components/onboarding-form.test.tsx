import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProfileActionState } from '../actions'

const actionMocks = vi.hoisted(() => ({
  completeActivation: vi.fn(async (): Promise<ProfileActionState> => ({ revision: 0 })),
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

describe('OnboardingForm persona activation', () => {
  it('starts with the human persona choices instead of Professional and Organisation roots', () => {
    render(<OnboardingForm initialFullName="Asha Singh" />)

    expect(screen.getByRole('button', { name: /^SeafarerMaster,/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Shore Professional/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Recruiter \/ HR/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Trainer \/ Instructor/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Student \/ Cadet/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Seafarer Family/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Maritime Enthusiast/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Other/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Professional$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Organisation$/i })).not.toBeInTheDocument()
  })

  it('shows intent choices and relevant seafarer fields after selecting Seafarer', () => {
    render(<OnboardingForm initialFullName="Asha Singh" />)

    fireEvent.click(screen.getByRole('button', { name: /^SeafarerMaster,/i }))

    expect(screen.getByText('What are you here to do?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Find jobs/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Hire people/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Learn/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Teach/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Attend events/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Host events/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Network/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Community/i })).toBeInTheDocument()

    expect(screen.getByLabelText('Full name')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Username/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Location')).toBeInTheDocument()
    expect(screen.getByLabelText('Current or most recent rank')).toBeInTheDocument()
    expect(screen.getByLabelText('Current / last organisation')).toBeInTheDocument()
    expect(screen.queryByLabelText('Professional summary')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sailing experience in years')).not.toBeInTheDocument()
  })

  it('keeps seafarer family onboarding lightweight and removes irrelevant professional fields', () => {
    render(<OnboardingForm initialFullName="Priya Singh" />)

    fireEvent.click(screen.getByRole('button', { name: /^Seafarer Family/i }))

    expect(screen.getByLabelText('Relationship to the maritime community')).toBeInTheDocument()
    expect(screen.queryByLabelText('Current or most recent rank')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Current / last organisation')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Training specialization')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Institute / academy')).not.toBeInTheDocument()
  })

  it('shows trainer and student fields only for those personas', () => {
    const { unmount } = render(<OnboardingForm initialFullName="Asha Singh" />)
    fireEvent.click(screen.getByRole('button', { name: /^Trainer \/ Instructor/i }))

    expect(screen.getByLabelText('Training specialization')).toBeInTheDocument()
    expect(screen.getByLabelText('Organisation / institute')).toBeInTheDocument()
    expect(screen.queryByLabelText('Institute / academy')).not.toBeInTheDocument()

    unmount()
    render(<OnboardingForm initialFullName="Asha Singh" />)
    fireEvent.click(screen.getByRole('button', { name: /^Student \/ Cadet/i }))

    expect(screen.getByLabelText('Institute / academy')).toBeInTheDocument()
    expect(screen.queryByLabelText('Training specialization')).not.toBeInTheDocument()
  })

  it('keeps Complete profile actionable so missing fields produce visible validation instead of a silent disabled button', () => {
    render(<OnboardingForm initialFullName="Asha Singh" />)

    expect(screen.getByRole('button', { name: 'Complete profile' })).toBeEnabled()
  })

  it('shows and focuses a clear persona error summary when the server rejects onboarding', async () => {
    actionMocks.completeActivation.mockResolvedValueOnce({
      revision: 1,
      fieldErrors: {
        persona: ['Choose the option that best describes you.'],
      },
      values: {},
    })
    render(<OnboardingForm initialFullName="Asha Singh" />)

    const form = screen.getByRole('button', { name: 'Complete profile' }).closest('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form!)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Please correct the highlighted information')
    expect(alert).toHaveTextContent('Choose the option that best describes you.')
    await waitFor(() => expect(document.activeElement).toHaveTextContent(/Which best describes you/i))
  })

  it('preserves persona, intent and entered values after server validation fails', async () => {
    actionMocks.completeActivation.mockResolvedValueOnce({
      revision: 1,
      fieldErrors: {
        slug: ['That username is already in use. Choose a different username and try again.'],
      },
      values: {
        persona: 'seafarer',
        profileIntents: JSON.stringify(['find_jobs', 'network']),
        fullName: 'Asha Updated',
        slug: 'asha-singh',
        location: 'Goa',
        currentCompany: 'Oceanic Shipping',
        rank: 'Chief Engineer',
        headline: 'Chief Engineer',
        contactVisibility: 'members',
      },
    })

    render(<OnboardingForm initialFullName="Asha Singh" />)
    fireEvent.click(screen.getByRole('button', { name: /^SeafarerMaster,/i }))
    fireEvent.click(screen.getByRole('button', { name: /Find jobs/i }))
    fireEvent.click(screen.getByRole('button', { name: /Network/i }))
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Asha Updated' } })
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Goa' } })
    fireEvent.change(screen.getByLabelText('Current or most recent rank'), { target: { value: 'Chief Engineer' } })
    fireEvent.change(screen.getByLabelText('Current / last organisation'), { target: { value: 'Oceanic Shipping' } })

    const form = screen.getByRole('button', { name: 'Complete profile' }).closest('form')
    fireEvent.submit(form!)

    await screen.findByRole('alert')
    expect(screen.getByLabelText('Full name')).toHaveValue('Asha Updated')
    expect(screen.getByLabelText('Location')).toHaveValue('Goa')
    expect(screen.getByLabelText('Current or most recent rank')).toHaveValue('Chief Engineer')
    expect(screen.getByLabelText('Current / last organisation')).toHaveValue('Oceanic Shipping')
    expect(screen.getByRole('button', { name: /Find jobs/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Network/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows an unexpected submit failure without clearing entered onboarding information', async () => {
    actionMocks.completeActivation.mockRejectedValueOnce(new Error('network unavailable'))

    render(<OnboardingForm initialFullName="Asha Singh" />)
    fireEvent.click(screen.getByRole('button', { name: /^SeafarerMaster,/i }))
    fireEvent.click(screen.getByRole('button', { name: /Find jobs/i }))
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Asha Updated' } })
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Goa' } })
    fireEvent.change(screen.getByLabelText('Current or most recent rank'), { target: { value: 'Chief Engineer' } })
    fireEvent.change(screen.getByLabelText('Current / last organisation'), { target: { value: 'Oceanic Shipping' } })

    const form = screen.getByRole('button', { name: 'Complete profile' }).closest('form')
    fireEvent.submit(form!)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not submit your profile/i)
    expect(alert).toHaveTextContent(/try again/i)
    expect(screen.getByLabelText('Full name')).toHaveValue('Asha Updated')
    expect(screen.getByLabelText('Location')).toHaveValue('Goa')
    expect(screen.getByLabelText('Current or most recent rank')).toHaveValue('Chief Engineer')
    expect(screen.getByLabelText('Current / last organisation')).toHaveValue('Oceanic Shipping')
    await waitFor(() => expect(document.activeElement).toBe(alert))
  })
})
