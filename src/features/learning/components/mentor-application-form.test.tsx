import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MentorApplicationInput } from '../mentor-application'

const mocks = vi.hoisted(() => ({
  submitMentorApplication: vi.fn(),
  resubmitMentorApplication: vi.fn(),
}))

vi.mock('../actions', () => ({
  submitMentorApplication: mocks.submitMentorApplication,
  resubmitMentorApplication: mocks.resubmitMentorApplication,
}))

import { MentorApplicationForm } from './mentor-application-form'

const initial: MentorApplicationInput = {
  name: 'Capt. Maya Singh',
  currentLastRank: 'Master Mariner',
  yearsExperience: 18,
  vesselTypes: ['Oil Tanker', 'Chemical Tanker'],
  specialization: 'SIRE 2.0, tanker operations and bridge leadership',
  certifications: ['Master Unlimited', 'ISO 9001 Lead Auditor'],
  linkedInUrl: 'https://www.linkedin.com/in/maya-singh-mariner',
  shortBio: 'Master Mariner with eighteen years of sea and shore experience focused on tanker safety, leadership and practical competency development.',
  profilePhotoPath: 'profiles/user-1/avatar.jpg',
  proposedCourseTopics: ['SIRE 2.0 readiness', 'Bridge leadership'],
}

describe('MentorApplicationForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.submitMentorApplication.mockResolvedValue({ ok: true, applicationId: '11111111-1111-4111-8111-111111111111' })
    mocks.resubmitMentorApplication.mockResolvedValue({ ok: true })
  })

  afterEach(() => cleanup())

  it('prefills maritime profile data and keeps the trainer-specific fields editable', () => {
    render(<MentorApplicationForm initialValue={initial} />)

    expect(screen.getByLabelText('Name')).toHaveValue('Capt. Maya Singh')
    expect(screen.getByLabelText('Current / last rank')).toHaveValue('Master Mariner')
    expect(screen.getByLabelText('Years of maritime experience')).toHaveValue(18)
    expect(screen.getByLabelText('Vessel types')).toHaveValue('Oil Tanker, Chemical Tanker')
    expect(screen.getByLabelText('Specialization')).toHaveValue(initial.specialization)
    expect(screen.getByLabelText('Certifications')).toHaveValue('Master Unlimited, ISO 9001 Lead Auditor')
    expect(screen.getByLabelText('Proposed course topics')).toHaveValue('SIRE 2.0 readiness, Bridge leadership')
    expect(screen.getByText('Apply to teach')).toBeInTheDocument()
  })

  it('normalizes list fields before submitting a new application', async () => {
    render(<MentorApplicationForm initialValue={initial} />)

    fireEvent.change(screen.getByLabelText('Vessel types'), { target: { value: ' Oil Tanker, oil tanker, LNG Carrier ' } })
    fireEvent.change(screen.getByLabelText('Proposed course topics'), { target: { value: ' SIRE 2.0 readiness, Human Factors ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit trainer verification application' }))

    await waitFor(() => expect(mocks.submitMentorApplication).toHaveBeenCalledTimes(1))
    expect(mocks.submitMentorApplication).toHaveBeenCalledWith(expect.objectContaining({
      vesselTypes: ['Oil Tanker', 'LNG Carrier'],
      proposedCourseTopics: ['SIRE 2.0 readiness', 'Human Factors'],
      profilePhotoPath: 'profiles/user-1/avatar.jpg',
    }))
    expect(await screen.findByText('Application submitted for review.')).toBeInTheDocument()
  })

  it('resubmits the same application after administrator feedback', async () => {
    render(
      <MentorApplicationForm
        initialValue={initial}
        applicationId="11111111-1111-4111-8111-111111111111"
        reviewNote="Please clarify your LNG/LPG teaching experience."
      />,
    )

    expect(screen.getByText('Please clarify your LNG/LPG teaching experience.')).toBeInTheDocument()
    expect(screen.getByText('Update application')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resubmit trainer verification application' }))

    await waitFor(() => expect(mocks.resubmitMentorApplication).toHaveBeenCalledTimes(1))
    expect(mocks.resubmitMentorApplication).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', initial)
    expect(await screen.findByText('Application resubmitted for review.')).toBeInTheDocument()
  })

  it('surfaces a safe action error without clearing the member input', async () => {
    mocks.submitMentorApplication.mockResolvedValueOnce({ ok: false, error: 'We could not save the trainer verification application. Please try again.' })
    render(<MentorApplicationForm initialValue={initial} />)

    fireEvent.click(screen.getByRole('button', { name: 'Submit trainer verification application' }))

    expect(await screen.findByText('We could not save the trainer verification application. Please try again.')).toBeInTheDocument()
    expect(screen.getByLabelText('Specialization')).toHaveValue(initial.specialization)
  })
})
