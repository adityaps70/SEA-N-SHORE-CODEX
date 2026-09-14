import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  submitCourseForReview: vi.fn(),
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('../course-actions', () => ({ submitCourseForReview: mocks.submitCourseForReview }))

import { CourseSubmitControl } from './course-submit-control'

const courseId = '33333333-3333-4333-8333-333333333333'

describe('CourseSubmitControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.submitCourseForReview.mockResolvedValue({ ok: true })
  })

  afterEach(() => cleanup())

  it('submits the exact course for Sea N Shore review and returns to Mentor Studio', async () => {
    render(<CourseSubmitControl courseId={courseId} />)

    expect(screen.getByText(/save your latest changes before submitting/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))

    await waitFor(() => expect(mocks.submitCourseForReview).toHaveBeenCalledWith(courseId))
    expect(await screen.findByText('Course submitted for Sea N Shore review.')).toBeInTheDocument()
    expect(mocks.push).toHaveBeenCalledWith('/learn/studio')
  })

  it('shows a safe workflow error without navigating away', async () => {
    mocks.submitCourseForReview.mockResolvedValueOnce({
      ok: false,
      error: 'This course cannot be submitted for review in its current state.',
    })
    render(<CourseSubmitControl courseId={courseId} />)

    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))

    expect(await screen.findByText('This course cannot be submitted for review in its current state.')).toBeInTheDocument()
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
