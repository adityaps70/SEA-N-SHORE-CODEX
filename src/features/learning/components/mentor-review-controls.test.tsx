import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reviewMentorApplication: vi.fn(),
}))

vi.mock('@/features/learning/admin-actions', () => ({
  reviewMentorApplication: mocks.reviewMentorApplication,
}))

import { MentorReviewControls } from './mentor-review-controls'

const applicationId = '11111111-1111-4111-8111-111111111111'

afterEach(() => {
  cleanup()
})

describe('MentorReviewControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reviewMentorApplication.mockResolvedValue({ ok: true, status: 'approved', mentorId: 'mentor-1' })
  })

  it('approves with an optional blank reviewer note', async () => {
    render(<MentorReviewControls applicationId={applicationId} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve mentor' }))

    await waitFor(() => expect(mocks.reviewMentorApplication).toHaveBeenCalledTimes(1))
    expect(mocks.reviewMentorApplication).toHaveBeenCalledWith(applicationId, 'approved', null)
    expect(await screen.findByText('Mentor approved. The verified mentor workspace is now active.')).toBeInTheDocument()
  })

  it.each([
    ['Request changes', 'changes_requested'],
    ['Reject application', 'rejected'],
  ] as const)('requires a reviewer note before %s', async (buttonName) => {
    render(<MentorReviewControls applicationId={applicationId} />)

    fireEvent.click(screen.getByRole('button', { name: buttonName }))

    expect(await screen.findByText('A reviewer note is required for this decision.')).toBeInTheDocument()
    expect(mocks.reviewMentorApplication).not.toHaveBeenCalled()
  })

  it('trims and submits administrator feedback when requesting changes', async () => {
    mocks.reviewMentorApplication.mockResolvedValueOnce({ ok: true, status: 'changes_requested', mentorId: null })
    render(<MentorReviewControls applicationId={applicationId} />)

    fireEvent.change(screen.getByLabelText('Reviewer note'), {
      target: { value: '  Please clarify LNG/LPG teaching experience.  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }))

    await waitFor(() => expect(mocks.reviewMentorApplication).toHaveBeenCalledTimes(1))
    expect(mocks.reviewMentorApplication).toHaveBeenCalledWith(
      applicationId,
      'changes_requested',
      'Please clarify LNG/LPG teaching experience.',
    )
    expect(await screen.findByText('Changes requested. The applicant can update and resubmit.')).toBeInTheDocument()
  })

  it('shows a safe server error without clearing the reviewer note', async () => {
    mocks.reviewMentorApplication.mockResolvedValueOnce({
      ok: false,
      error: 'This mentor application cannot move to that review state.',
    })
    render(<MentorReviewControls applicationId={applicationId} />)

    fireEvent.change(screen.getByLabelText('Reviewer note'), {
      target: { value: 'Credential evidence needs another review.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reject application' }))

    expect(await screen.findByText('This mentor application cannot move to that review state.')).toBeInTheDocument()
    expect(screen.getByLabelText('Reviewer note')).toHaveValue('Credential evidence needs another review.')
  })
})
