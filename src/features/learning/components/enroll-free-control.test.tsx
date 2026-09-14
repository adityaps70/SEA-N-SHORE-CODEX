import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enrollInFreeCourse: vi.fn(),
}))

vi.mock('../enrollment-actions', () => ({ enrollInFreeCourse: mocks.enrollInFreeCourse }))

import { EnrollFreeControl } from './enroll-free-control'

const courseId = '22222222-2222-4222-8222-222222222222'

describe('EnrollFreeControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enrollInFreeCourse.mockResolvedValue({
      ok: true,
      enrollmentId: '33333333-3333-4333-8333-333333333333',
      alreadyEnrolled: false,
    })
  })

  afterEach(() => cleanup())

  it('enrolls the learner in the exact free course and exposes My Learning', async () => {
    render(<EnrollFreeControl courseId={courseId} initiallyEnrolled={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Enroll free' }))

    await waitFor(() => expect(mocks.enrollInFreeCourse).toHaveBeenCalledWith(courseId))
    expect(await screen.findByText('You are enrolled in this course.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enroll free' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to My Learning' })).toHaveAttribute('href', '/learn/my-learning')
  })

  it('renders an honest enrolled state without offering a duplicate enrollment action', () => {
    render(<EnrollFreeControl courseId={courseId} initiallyEnrolled />)

    expect(screen.getByText('You are enrolled in this course.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enroll free' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to My Learning' })).toHaveAttribute('href', '/learn/my-learning')
    expect(mocks.enrollInFreeCourse).not.toHaveBeenCalled()
  })

  it('shows the safe server-action error without pretending enrollment succeeded', async () => {
    mocks.enrollInFreeCourse.mockResolvedValueOnce({
      ok: false,
      error: 'This course is not currently available for free enrollment.',
    })
    render(<EnrollFreeControl courseId={courseId} initiallyEnrolled={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Enroll free' }))

    expect(await screen.findByText('This course is not currently available for free enrollment.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enroll free' })).toBeInTheDocument()
    expect(screen.queryByText('You are enrolled in this course.')).not.toBeInTheDocument()
  })
})
