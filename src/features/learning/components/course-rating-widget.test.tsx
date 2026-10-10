import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('../course-rating-actions', () => ({ saveCourseReview: mocks.save }))

import { CourseRatingWidget } from './course-rating-widget'

const courseId = '33333333-3333-4333-8333-333333333333'

afterEach(() => cleanup())
beforeEach(() => vi.clearAllMocks())

describe('CourseRatingWidget (learning round C)', () => {
  it('asks for 20% progress before a learner can rate', () => {
    render(<CourseRatingWidget courseId={courseId} eligibility={{ canReview: false, reason: 'progress', progressPercent: 16, review: null }} />)
    expect(screen.getByRole('heading', { name: 'Rate this course' })).toBeInTheDocument()
    expect(screen.getByText('You can rate this course once you’ve completed 20% of it. You’re at 16%.')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('is hidden from the course team and from people who are not enrolled', () => {
    const { container, rerender } = render(<CourseRatingWidget courseId={courseId} eligibility={{ canReview: false, reason: 'course_team', progressPercent: 0, review: null }} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<CourseRatingWidget courseId={courseId} eligibility={{ canReview: false, reason: 'not_enrolled', progressPercent: 0, review: null }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('submits stars and an optional review, then says it waits for approval', async () => {
    mocks.save.mockResolvedValue({ ok: true, review: { id: 'r1', rating: 4, body: 'Clear and practical.', status: 'pending', updatedAt: '2026-10-10T10:00:00.000Z' } })
    render(<CourseRatingWidget courseId={courseId} eligibility={{ canReview: true, reason: null, progressPercent: 40, review: null }} />)

    expect(screen.getAllByRole('radio')).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: 'Submit rating' }))
    expect(screen.getByText('Choose from 1 to 5 stars.')).toBeInTheDocument()
    expect(mocks.save).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('radio', { name: '4 stars, Very good' }))
    expect(screen.getByText('4 of 5 · Very good')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Your review/), { target: { value: 'Clear and practical.' } })
    expect(screen.getByText('20/2,000 characters')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Submit rating' }))

    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(courseId, { rating: 4, body: 'Clear and practical.' }))
    expect(await screen.findByText(/It will appear on the course page once Sea N Shore approves it/)).toBeInTheDocument()
    // The saved state renders after the transition ends; wait for it rather than racing it under a busy test run.
    expect(await screen.findByRole('button', { name: 'Update rating' })).toBeDisabled()
  })

  it('shows the status of an existing review and the server’s plain message under the field', async () => {
    mocks.save.mockResolvedValue({ ok: false, error: 'Your review can be at most 2,000 characters.', fieldErrors: { body: ['Your review can be at most 2,000 characters.'] } })
    render(<CourseRatingWidget courseId={courseId} eligibility={{ canReview: true, reason: null, progressPercent: 60, review: { id: 'r1', rating: 5, body: 'Great.', status: 'approved', updatedAt: '2026-10-01T10:00:00.000Z' } }} />)

    expect(screen.getByRole('radio', { name: '5 stars, Excellent' })).toBeChecked()
    expect(screen.getByText(/Your rating shows on the course page/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update rating' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Your review/), { target: { value: 'Great, and longer.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update rating' }))
    expect(await screen.findByText('Your review can be at most 2,000 characters.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Your review/)).toHaveAttribute('aria-invalid', 'true')
  })

  it('tells a learner whose access ended that they can no longer rate', () => {
    render(<CourseRatingWidget courseId={courseId} eligibility={{ canReview: false, reason: 'access_ended', progressPercent: 80, review: { id: 'r1', rating: 3, body: '', status: 'pending', updatedAt: '2026-10-01T10:00:00.000Z' } }} />)
    expect(screen.getByText('Your access to this course has ended, so you can’t rate it now.')).toBeInTheDocument()
    expect(screen.getByText(/Waiting for approval/)).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })
})
