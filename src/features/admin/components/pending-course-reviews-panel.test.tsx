import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingCourseReview } from '@/features/learning/course-rating-repository'

const mocks = vi.hoisted(() => ({ decide: vi.fn(), refresh: vi.fn() }))
vi.mock('@/features/learning/course-rating-actions', () => ({ decideCourseReview: mocks.decide }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))

import { PendingCourseReviewsPanel } from './pending-course-reviews-panel'

const review: PendingCourseReview = {
  id: '66666666-6666-4666-8666-666666666666',
  rating: 4,
  body: 'Fixture review text.',
  createdAt: '2026-10-09T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
  edited: true,
  course: { id: '33333333-3333-4333-8333-333333333333', title: 'Fixture SIRE Readiness', slug: 'fixture-sire' },
  reviewer: { id: '77777777-7777-4777-8777-777777777777', name: 'Fixture Learner Ada', slug: null },
  screening: { decision: 'review', category: 'abusive_content', reason: 'harassment', ruleIds: ['abusive_harassment'] },
}

afterEach(() => cleanup())
beforeEach(() => vi.clearAllMocks())

describe('PendingCourseReviewsPanel (learning round C)', () => {
  it('lists reviews waiting for approval with the screening signal, and approves the version the moderator read', async () => {
    mocks.decide.mockResolvedValue({ ok: true })
    render(<PendingCourseReviewsPanel reviews={[review]} />)

    expect(screen.getByRole('heading', { name: 'Course reviews to approve' })).toBeInTheDocument()
    const card = screen.getByRole('article', { name: 'Review of Fixture SIRE Readiness' })
    expect(within(card).getByText('Fixture review text.')).toBeInTheDocument()
    expect(within(card).getByText('Edited')).toBeInTheDocument()
    expect(within(card).getByText('Automated screening: abusive content')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith({ reviewId: review.id, decision: 'approved', note: undefined, expectedUpdatedAt: review.updatedAt }))
    expect(await within(card).findByText(/Approved\. The review now shows on the course page\./)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Reject' })).toBeDisabled()
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('rejects with a note and shows a refusal plainly', async () => {
    mocks.decide.mockResolvedValue({ ok: false, error: 'The learner changed this review after you opened the page. Refresh to read the new version before deciding.' })
    render(<PendingCourseReviewsPanel reviews={[{ ...review, screening: { decision: 'allow', category: null, reason: null, ruleIds: [] } }]} />)
    expect(screen.queryByText(/Automated screening/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Moderator note/), { target: { value: 'Off topic.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith(expect.objectContaining({ decision: 'rejected', note: 'Off topic.' })))
    expect(await screen.findByText(/The learner changed this review/)).toBeInTheDocument()
  })

  it('says when nothing is waiting', () => {
    render(<PendingCourseReviewsPanel reviews={[]} />)
    expect(screen.getByText('No course reviews are waiting for approval.')).toBeInTheDocument()
  })
})
