import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModerationCourseReviewReply } from '@/features/learning/course-rating-repository'

const mocks = vi.hoisted(() => ({ setStatus: vi.fn(), refresh: vi.fn() }))
vi.mock('@/features/learning/course-review-reply-actions', () => ({ setCourseReviewReplyStatus: mocks.setStatus }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))

import { CourseReviewRepliesPanel } from './course-review-replies-panel'

const reply: ModerationCourseReviewReply = {
  reviewId: '66666666-6666-4666-8666-666666666666',
  body: 'Placeholder owner reply.',
  status: 'visible',
  repliedAt: '2026-10-10T10:00:00.000Z',
  reviewRating: 2,
  reviewBody: 'Placeholder review text.',
  course: { id: '33333333-3333-4333-8333-333333333333', title: 'Placeholder Course', slug: 'placeholder-course' },
  publisherName: 'Placeholder Marine Org',
}

afterEach(() => cleanup())
beforeEach(() => vi.clearAllMocks())

describe('CourseReviewRepliesPanel (round H)', () => {
  it('lists replies with the review they answer and hides one with a note', async () => {
    mocks.setStatus.mockResolvedValue({ ok: true })
    render(<CourseReviewRepliesPanel replies={[reply, { ...reply, reviewId: '77777777-7777-4777-8777-777777777777', status: 'hidden' }]} />)

    expect(screen.getByRole('heading', { name: 'Course owners’ replies to reviews' })).toBeInTheDocument()
    expect(screen.getByText(/The newest 2 replies, 1 hidden\./)).toBeInTheDocument()
    const [visibleCard, hiddenCard] = screen.getAllByRole('article', { name: 'Reply on Placeholder Course' })
    expect(within(visibleCard!).getByText('Placeholder owner reply.')).toBeInTheDocument()
    expect(within(visibleCard!).getByText('Reply from Placeholder Marine Org')).toBeInTheDocument()
    expect(within(visibleCard!).getByRole('link', { name: 'Placeholder Course' })).toHaveAttribute('href', '/learn/courses/placeholder-course#course-reviews')
    expect(within(hiddenCard!).getByRole('button', { name: 'Restore reply' })).toBeInTheDocument()

    fireEvent.change(within(visibleCard!).getByLabelText('Moderator note (optional)'), { target: { value: 'Contains a phone number.' } })
    fireEvent.click(within(visibleCard!).getByRole('button', { name: 'Hide reply' }))
    await waitFor(() => expect(mocks.setStatus).toHaveBeenCalledWith({ reviewId: reply.reviewId, status: 'hidden', note: 'Contains a phone number.' }))
    expect(await within(visibleCard!).findByText(/Hidden\. The reply no longer shows on the course page\./)).toBeInTheDocument()
    expect(within(visibleCard!).getByRole('button', { name: 'Restore reply' })).toBeInTheDocument()
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('restores a hidden reply and shows a refusal plainly', async () => {
    mocks.setStatus.mockResolvedValue({ ok: false, error: 'Someone has already changed this reply. Refresh the page to see the current list.' })
    render(<CourseReviewRepliesPanel replies={[{ ...reply, status: 'hidden' }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Restore reply' }))
    await waitFor(() => expect(mocks.setStatus).toHaveBeenCalledWith({ reviewId: reply.reviewId, status: 'visible', note: undefined }))
    expect(await screen.findByText(/Someone has already changed this reply/)).toBeInTheDocument()
  })

  it('says when there are no replies', () => {
    render(<CourseReviewRepliesPanel replies={[]} />)
    expect(screen.getByText('No course owner has replied to a review yet.')).toBeInTheDocument()
  })
})
