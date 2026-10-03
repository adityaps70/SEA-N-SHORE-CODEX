import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  gradeAssignmentAttempt: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))
vi.mock('../assignment-grading-actions', () => ({
  gradeAssignmentAttempt: mocks.gradeAssignmentAttempt,
}))

import { AssignmentGradingControl } from './assignment-grading-control'

const attemptId = '22222222-2222-4222-8222-222222222222'

afterEach(() => cleanup())

describe('AssignmentGradingControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.gradeAssignmentAttempt.mockResolvedValue({
      ok: true,
      passed: true,
      percentage: 85,
      scorePoints: 85,
      maxPoints: 100,
    })
  })

  it('offers explicit Pass and Needs revision decisions instead of a generic publish action', () => {
    render(<AssignmentGradingControl attemptId={attemptId} maxPoints={100} passingPercentage={70} />)

    expect(screen.getByRole('button', { name: 'Pass' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Needs revision' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publish grade' })).not.toBeInTheDocument()
  })

  it('submits a passing score with the explicit pass decision and refreshes the review', async () => {
    render(<AssignmentGradingControl attemptId={attemptId} maxPoints={100} passingPercentage={70} />)

    fireEvent.change(screen.getByLabelText('Score / 100'), { target: { value: '85' } })
    fireEvent.change(screen.getByLabelText('Feedback'), { target: { value: '  Strong evidence and clear reasoning.  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }))

    await waitFor(() => expect(mocks.gradeAssignmentAttempt).toHaveBeenCalledTimes(1))
    expect(mocks.gradeAssignmentAttempt).toHaveBeenCalledWith(
      attemptId,
      85,
      'Strong evidence and clear reasoning.',
      'pass',
    )
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('requires actionable feedback before requesting revision', async () => {
    render(<AssignmentGradingControl attemptId={attemptId} maxPoints={100} passingPercentage={70} />)

    fireEvent.change(screen.getByLabelText('Score / 100'), { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Needs revision' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Feedback is required when requesting revision.')
    expect(mocks.gradeAssignmentAttempt).not.toHaveBeenCalled()
  })

  it('submits a below-threshold score with needs revision and preserves learner progression gating', async () => {
    mocks.gradeAssignmentAttempt.mockResolvedValueOnce({
      ok: true,
      passed: false,
      percentage: 60,
      scorePoints: 60,
      maxPoints: 100,
    })
    render(<AssignmentGradingControl attemptId={attemptId} maxPoints={100} passingPercentage={70} />)

    fireEvent.change(screen.getByLabelText('Score / 100'), { target: { value: '60' } })
    fireEvent.change(screen.getByLabelText('Feedback'), { target: { value: 'Add stronger inspection evidence.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Needs revision' }))

    await waitFor(() => expect(mocks.gradeAssignmentAttempt).toHaveBeenCalledTimes(1))
    expect(mocks.gradeAssignmentAttempt).toHaveBeenCalledWith(
      attemptId,
      60,
      'Add stronger inspection evidence.',
      'needs_revision',
    )
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('blocks a Pass decision below the configured pass threshold before calling the server', async () => {
    render(<AssignmentGradingControl attemptId={attemptId} maxPoints={100} passingPercentage={70} />)

    fireEvent.change(screen.getByLabelText('Score / 100'), { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Pass requires a score meeting the 70% pass mark.')
    expect(mocks.gradeAssignmentAttempt).not.toHaveBeenCalled()
  })

  it('blocks Needs revision at or above the configured pass threshold', async () => {
    render(<AssignmentGradingControl attemptId={attemptId} maxPoints={100} passingPercentage={70} />)

    fireEvent.change(screen.getByLabelText('Score / 100'), { target: { value: '85' } })
    fireEvent.change(screen.getByLabelText('Feedback'), { target: { value: 'Please revise.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Needs revision' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Needs revision requires a score below the 70% pass mark.')
    expect(mocks.gradeAssignmentAttempt).not.toHaveBeenCalled()
  })

  it('shows a safe server error without clearing mentor feedback', async () => {
    mocks.gradeAssignmentAttempt.mockResolvedValueOnce({ ok: false, error: 'This submission has already been graded.' })
    render(<AssignmentGradingControl attemptId={attemptId} maxPoints={100} passingPercentage={70} />)

    fireEvent.change(screen.getByLabelText('Score / 100'), { target: { value: '60' } })
    fireEvent.change(screen.getByLabelText('Feedback'), { target: { value: 'Keep this feedback visible.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Needs revision' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This submission has already been graded.')
    expect(screen.getByLabelText('Feedback')).toHaveValue('Keep this feedback visible.')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
