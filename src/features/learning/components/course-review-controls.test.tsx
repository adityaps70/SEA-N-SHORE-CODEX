import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reviewCourse: vi.fn(),
}))

vi.mock('@/features/learning/admin-actions', () => ({
  reviewCourse: mocks.reviewCourse,
}))

import { CourseReviewControls } from './course-review-controls'

const courseId = '22222222-2222-4222-8222-222222222222'

afterEach(() => cleanup())

describe('CourseReviewControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reviewCourse.mockResolvedValue({ ok: true, status: 'published' })
  })

  it('shows review actions for a submitted course and approves without requiring a note', async () => {
    render(<CourseReviewControls courseId={courseId} status="submitted" />)

    expect(screen.getByRole('button', { name: 'Approve course' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publish course' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Approve course' }))

    await waitFor(() => expect(mocks.reviewCourse).toHaveBeenCalledTimes(1))
    expect(mocks.reviewCourse).toHaveBeenCalledWith(courseId, 'approved', null)
    expect(await screen.findByText('Course approved and published. It is now visible in Learn.')).toBeInTheDocument()
  })

  it('requires a reviewer note locally before requesting changes', async () => {
    render(<CourseReviewControls courseId={courseId} status="submitted" />)

    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }))

    expect(await screen.findByText('A reviewer note is required when requesting course changes.')).toBeInTheDocument()
    expect(mocks.reviewCourse).not.toHaveBeenCalled()
  })

  it('trims and submits course feedback when requesting changes', async () => {
    mocks.reviewCourse.mockResolvedValueOnce({ ok: true, status: 'changes_requested' })
    render(<CourseReviewControls courseId={courseId} status="submitted" />)

    fireEvent.change(screen.getByLabelText('Course reviewer note'), {
      target: { value: '  Make the learning outcomes measurable and role-specific.  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }))

    await waitFor(() => expect(mocks.reviewCourse).toHaveBeenCalledTimes(1))
    expect(mocks.reviewCourse).toHaveBeenCalledWith(
      courseId,
      'changes_requested',
      'Make the learning outcomes measurable and role-specific.',
    )
    expect(await screen.findByText('Changes requested. The trainer or organization manager can revise and resubmit the course.')).toBeInTheDocument()
  })

  it('shows only publish for an approved course', async () => {
    mocks.reviewCourse.mockResolvedValueOnce({ ok: true, status: 'published' })
    render(<CourseReviewControls courseId={courseId} status="approved" />)

    expect(screen.queryByRole('button', { name: 'Approve course' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request changes' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Publish course' }))

    await waitFor(() => expect(mocks.reviewCourse).toHaveBeenCalledTimes(1))
    expect(mocks.reviewCourse).toHaveBeenCalledWith(courseId, 'published', null)
    expect(await screen.findByText('Course published. It is now eligible for the learning marketplace.')).toBeInTheDocument()
  })

  it('shows only archive for a published course', async () => {
    mocks.reviewCourse.mockResolvedValueOnce({ ok: true, status: 'archived' })
    render(<CourseReviewControls courseId={courseId} status="published" />)

    expect(screen.queryByRole('button', { name: 'Publish course' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Archive course' }))

    await waitFor(() => expect(mocks.reviewCourse).toHaveBeenCalledTimes(1))
    expect(mocks.reviewCourse).toHaveBeenCalledWith(courseId, 'archived', null)
    expect(await screen.findByText('Course archived. It is off the catalogue and closed to new learners; enrolled learners keep their access.')).toBeInTheDocument()
  })

  it('renders no mutation buttons for historical non-actionable statuses', () => {
    render(<CourseReviewControls courseId={courseId} status="changes_requested" />)

    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('offers only unarchive for an archived course, returning it to the catalogue', async () => {
    mocks.reviewCourse.mockResolvedValueOnce({ ok: true, status: 'published' })
    render(<CourseReviewControls courseId={courseId} status="archived" />)

    expect(screen.getAllByRole('button')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive course' }))

    await waitFor(() => expect(mocks.reviewCourse).toHaveBeenCalledWith(courseId, 'published', null))
    expect(await screen.findByText('Course unarchived. It is back in the catalogue and open to new learners.')).toBeInTheDocument()
  })

  it('reviews changes to a published course with approve-and-apply or request changes only', async () => {
    mocks.reviewCourse.mockResolvedValueOnce({ ok: true, status: 'published' })
    render(<CourseReviewControls courseId={courseId} status="submitted" revision />)

    expect(screen.queryByRole('button', { name: 'Archive course' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve and apply changes' }))

    await waitFor(() => expect(mocks.reviewCourse).toHaveBeenCalledWith(courseId, 'approved', null))
    expect(await screen.findByText('Changes approved and applied to the live course. Learners keep their progress.')).toBeInTheDocument()
  })

  it('shows a safe server error without clearing reviewer feedback', async () => {
    mocks.reviewCourse.mockResolvedValueOnce({
      ok: false,
      error: 'This course cannot move to that review state.',
    })
    render(<CourseReviewControls courseId={courseId} status="submitted" />)

    fireEvent.change(screen.getByLabelText('Course reviewer note'), {
      target: { value: 'Keep this feedback available if the server rejects the decision.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Approve course' }))

    expect(await screen.findByText('This course cannot move to that review state.')).toBeInTheDocument()
    expect(screen.getByLabelText('Course reviewer note')).toHaveValue('Keep this feedback available if the server rejects the decision.')
  })
})
