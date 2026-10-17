import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(async () => ({ id: 'owner-1' })),
  adminActionMfaMissing: vi.fn(async () => false),
  saveReply: vi.fn(),
  deleteReply: vi.fn(),
  setReplyStatus: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/admin/mfa-gate', () => ({ ADMIN_MFA_REQUIRED_MESSAGE: 'Set up MFA first.', adminActionMfaMissing: mocks.adminActionMfaMissing }))
vi.mock('./course-rating-repository', () => ({
  courseRatingRepository: { saveReply: mocks.saveReply, deleteReply: mocks.deleteReply, setReplyStatus: mocks.setReplyStatus },
}))

import { deleteCourseReviewReply, saveCourseReviewReply, setCourseReviewReplyStatus } from './course-review-reply-actions'

const REVIEW_ID = '66666666-6666-4666-8666-666666666666'

beforeEach(() => vi.clearAllMocks())

describe('course review reply actions (round H)', () => {
  it('validates the reply with zod before touching the database', async () => {
    expect(await saveCourseReviewReply({ reviewId: 'not-a-uuid', body: 'Hello', mode: 'add' })).toMatchObject({ ok: false })
    expect(await saveCourseReviewReply({ reviewId: REVIEW_ID, body: '   ', mode: 'add' })).toEqual({
      ok: false,
      error: 'Write your reply before saving.',
      fieldErrors: { body: ['Write your reply before saving.'] },
    })
    expect(await saveCourseReviewReply({ reviewId: REVIEW_ID, body: 'x'.repeat(2001), mode: 'add' })).toMatchObject({ ok: false, error: 'Your reply can be at most 2,000 characters.' })
    expect(await saveCourseReviewReply({ reviewId: REVIEW_ID, body: 'Hello', mode: 'replace' as 'add' })).toMatchObject({ ok: false })
    expect(mocks.saveReply).not.toHaveBeenCalled()
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
  })

  it('saves a trimmed reply for the signed-in member and explains refusals plainly', async () => {
    mocks.saveReply.mockResolvedValueOnce({ reviewId: REVIEW_ID, courseId: 'course-1', reply: { body: 'Thanks.', repliedAt: '2026-10-10T10:00:00.000Z', status: 'visible' } })
    expect(await saveCourseReviewReply({ reviewId: REVIEW_ID, body: '  Thanks.  ', mode: 'add' })).toMatchObject({ ok: true, reply: { body: 'Thanks.' } })
    expect(mocks.saveReply).toHaveBeenCalledWith('owner-1', { reviewId: REVIEW_ID, body: 'Thanks.', mode: 'add' })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/courses/[slug]', 'page')

    mocks.saveReply.mockRejectedValueOnce(new Error('reply_forbidden'))
    expect(await saveCourseReviewReply({ reviewId: REVIEW_ID, body: 'Thanks.', mode: 'add' })).toEqual({ ok: false, error: 'Only the people who run this course can reply to its reviews.' })
    mocks.saveReply.mockRejectedValueOnce(new Error('reply_exists'))
    expect(await saveCourseReviewReply({ reviewId: REVIEW_ID, body: 'Thanks.', mode: 'add' })).toMatchObject({ ok: false, error: expect.stringContaining('already has a reply') })
    mocks.saveReply.mockRejectedValueOnce(new Error('reply_blocked'))
    expect(await saveCourseReviewReply({ reviewId: REVIEW_ID, body: 'Thanks.', mode: 'add' })).toMatchObject({ ok: false, fieldErrors: { body: [expect.any(String)] } })
  })

  it('deletes a reply', async () => {
    mocks.deleteReply.mockResolvedValueOnce({ reviewId: REVIEW_ID, courseId: 'course-1', reply: null })
    expect(await deleteCourseReviewReply({ reviewId: REVIEW_ID })).toEqual({ ok: true, reply: null })
    expect(mocks.deleteReply).toHaveBeenCalledWith('owner-1', { reviewId: REVIEW_ID })
    expect(await deleteCourseReviewReply({ reviewId: 'nope' })).toMatchObject({ ok: false })
  })

  it('gates hiding and restoring on admin MFA', async () => {
    mocks.adminActionMfaMissing.mockResolvedValueOnce(true)
    expect(await setCourseReviewReplyStatus({ reviewId: REVIEW_ID, status: 'hidden' })).toEqual({ ok: false, error: 'Set up MFA first.' })
    expect(mocks.setReplyStatus).not.toHaveBeenCalled()

    mocks.setReplyStatus.mockResolvedValueOnce({ courseId: 'course-1', status: 'hidden' })
    expect(await setCourseReviewReplyStatus({ reviewId: REVIEW_ID, status: 'hidden', note: '  Phone number.  ' })).toEqual({ ok: true })
    expect(mocks.setReplyStatus).toHaveBeenCalledWith('owner-1', { reviewId: REVIEW_ID, status: 'hidden', note: 'Phone number.' })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/moderation')

    mocks.setReplyStatus.mockRejectedValueOnce(new Error('admin_forbidden'))
    expect(await setCourseReviewReplyStatus({ reviewId: REVIEW_ID, status: 'visible' })).toEqual({ ok: false, error: 'You do not have permission to moderate platform content.' })
    expect(await setCourseReviewReplyStatus({ reviewId: REVIEW_ID, status: 'removed' as 'hidden' })).toMatchObject({ ok: false })
  })
})
