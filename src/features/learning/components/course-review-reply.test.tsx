import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicCourseReviews } from '../course-rating-repository'

const mocks = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn(), refresh: vi.fn() }))
vi.mock('../course-review-reply-actions', () => ({ saveCourseReviewReply: mocks.save, deleteCourseReviewReply: mocks.remove }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/features/moderation/actions', () => ({ reportContent: vi.fn() }))

import { CourseReviewsSection } from './course-reviews-section'
import { CourseReviewOwnerReply } from './course-review-reply'
import { replyCharactersLeft } from '../course-review-reply-rules'

const REVIEW_ID = '66666666-6666-4666-8666-666666666666'

const data: PublicCourseReviews = {
  averageRating: 4,
  reviewCount: 2,
  reviews: [
    {
      id: REVIEW_ID,
      rating: 4,
      body: 'Placeholder review text.',
      reviewedAt: '2026-10-05T10:00:00.000Z',
      reviewer: { id: 'fixture-a', name: 'Placeholder Learner A', slug: null },
      reply: { body: 'Thank you for the feedback.', repliedAt: '2026-10-06T10:00:00.000Z' },
    },
    {
      id: '77777777-7777-4777-8777-777777777777',
      rating: 4,
      body: 'Another placeholder review.',
      reviewedAt: '2026-10-04T10:00:00.000Z',
      reviewer: { id: 'fixture-b', name: 'Placeholder Learner B', slug: null },
      reply: null,
    },
  ],
}

afterEach(() => cleanup())
beforeEach(() => vi.clearAllMocks())

describe('replyCharactersLeft', () => {
  it('counts down with the right plural', () => {
    expect(replyCharactersLeft(0)).toBe('2000 characters left')
    expect(replyCharactersLeft(1999)).toBe('1 character left')
    expect(replyCharactersLeft(2000)).toBe('0 characters left')
    expect(replyCharactersLeft(2001)).toBe('1 character over the limit')
    expect(replyCharactersLeft(2003)).toBe('3 characters over the limit')
  })
})

describe('course review replies on the course page (round H)', () => {
  it('shows a visible reply under its review, labelled with the publisher', () => {
    render(<CourseReviewsSection data={data} viewerId={null} publisherName="Placeholder Marine Org" />)
    const first = screen.getByRole('article', { name: 'Review by Placeholder Learner A' })
    const reply = within(first).getByRole('group', { name: 'Reply from Placeholder Marine Org' })
    expect(within(reply).getByText('Thank you for the feedback.')).toBeInTheDocument()
    expect(within(reply).getByText('Reply from Placeholder Marine Org')).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Review by Placeholder Learner B' })).queryByRole('group')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument()
  })

  it('gives the course owner Reply on unanswered reviews and shows hidden replies to them only, marked hidden', () => {
    render(
      <CourseReviewsSection
        data={data}
        viewerId="owner-1"
        publisherName="Placeholder Marine Org"
        ownerView={{ replies: { [REVIEW_ID]: { body: 'A reply a moderator hid.', repliedAt: '2026-10-06T10:00:00.000Z', status: 'hidden' } } }}
      />,
    )
    const first = screen.getByRole('article', { name: 'Review by Placeholder Learner A' })
    expect(within(first).getByText('A reply a moderator hid.')).toBeInTheDocument()
    expect(within(first).getByText('Hidden by Sea N Shore moderators')).toBeInTheDocument()
    expect(within(first).getByRole('button', { name: 'Edit reply' })).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Review by Placeholder Learner B' })).getByRole('button', { name: 'Reply' })).toBeInTheDocument()
  })
})

describe('CourseReviewOwnerReply form (round H)', () => {
  it('has a labelled field with a live character count, shows errors next to it, and posts the reply', async () => {
    mocks.save.mockResolvedValueOnce({ ok: false, error: 'Your reply can be at most 2,000 characters.', fieldErrors: { body: ['Message from the server.'] } })
    mocks.save.mockResolvedValueOnce({ ok: true, reply: { body: 'Thanks for the review.', repliedAt: '2026-10-07T10:00:00.000Z', status: 'visible' } })
    render(<CourseReviewOwnerReply reviewId={REVIEW_ID} publisherName="Placeholder Marine Org" reply={null} />)

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    const field = screen.getByLabelText('Your reply')
    expect(field.tagName).toBe('TEXTAREA')
    expect(screen.getByText('2000 characters left')).toBeInTheDocument()
    expect(field).toHaveAccessibleDescription(/Shown under the review as “Reply from Placeholder Marine Org”.*2000 characters left/)

    // Empty: refused in the browser, with the error tied to the field.
    fireEvent.click(screen.getByRole('button', { name: 'Post reply' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Write your reply before saving.')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription(/Write your reply before saving\./)
    expect(mocks.save).not.toHaveBeenCalled()

    fireEvent.change(field, { target: { value: 'x'.repeat(2001) } })
    expect(screen.getByText('1 character over the limit')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Post reply' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Your reply can be at most 2,000 characters.')
    expect(mocks.save).not.toHaveBeenCalled()

    fireEvent.change(field, { target: { value: 'Thanks for the review.' } })
    expect(screen.getByText('1978 characters left')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Post reply' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ reviewId: REVIEW_ID, body: 'Thanks for the review.', mode: 'add' }))
    expect(await screen.findByText('Message from the server.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Post reply' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Reply posted.')
    expect(screen.getByRole('group', { name: 'Reply from Placeholder Marine Org' })).toHaveTextContent('Thanks for the review.')
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('edits the existing reply and deletes it after confirming', async () => {
    mocks.save.mockResolvedValue({ ok: true, reply: { body: 'Edited reply.', repliedAt: '2026-10-08T10:00:00.000Z', status: 'visible' } })
    mocks.remove.mockResolvedValue({ ok: true, reply: null })
    render(<CourseReviewOwnerReply reviewId={REVIEW_ID} publisherName="Placeholder Marine Org" reply={{ body: 'First reply.', repliedAt: '2026-10-06T10:00:00.000Z', status: 'visible' }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit reply' }))
    const field = screen.getByLabelText('Edit your reply')
    expect(field).toHaveValue('First reply.')
    fireEvent.change(field, { target: { value: 'Edited reply.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save reply' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ reviewId: REVIEW_ID, body: 'Edited reply.', mode: 'edit' }))
    expect(await screen.findByText('Edited reply.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete reply' }))
    const confirm = screen.getByRole('group', { name: 'Delete this reply?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete reply' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ reviewId: REVIEW_ID }))
    expect(await screen.findByRole('status')).toHaveTextContent('Reply deleted.')
    expect(screen.getByRole('button', { name: 'Reply' })).toBeInTheDocument()
  })

  it('cancels without saving', () => {
    render(<CourseReviewOwnerReply reviewId={REVIEW_ID} publisherName="Placeholder Marine Org" reply={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Your reply')).not.toBeInTheDocument()
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
