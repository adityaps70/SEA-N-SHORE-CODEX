import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  adminActionMfaMissing: vi.fn(),
  saveReview: vi.fn(),
  decideReview: vi.fn(),
  postAnnouncement: vi.fn(),
  setLink: vi.fn(),
  openDiscussion: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`) }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/admin/mfa-gate', () => ({ ADMIN_MFA_REQUIRED_MESSAGE: 'Turn on your authenticator app.', adminActionMfaMissing: mocks.adminActionMfaMissing }))
vi.mock('./course-rating-repository', () => ({ REVIEW_BODY_MAX_LENGTH: 2000, courseRatingRepository: { saveReview: mocks.saveReview, decideReview: mocks.decideReview } }))
vi.mock('./course-announcement-repository', () => ({
  ANNOUNCEMENT_TITLE_MAX_LENGTH: 140,
  ANNOUNCEMENT_BODY_MAX_LENGTH: 5000,
  courseAnnouncementRepository: { postAnnouncement: mocks.postAnnouncement },
}))
vi.mock('./course-community-repository', () => ({ courseCommunityRepository: { setLink: mocks.setLink, openDiscussion: mocks.openDiscussion } }))

import { postCourseAnnouncement } from './course-announcement-actions'
import { linkCourseCommunity, openCourseDiscussion } from './course-community-actions'
import { decideCourseReview, saveCourseReview } from './course-rating-actions'

/** Learning round C (C5, C7) server actions: plain messages, and every action re-checks who is asking. */

const RAW_WORDING = /Too small|Too big|expected (string|number)|Invalid input|Invalid option|received (NaN|undefined)/
const courseId = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'member-1' })
  mocks.adminActionMfaMissing.mockResolvedValue(false)
})

describe('saveCourseReview', () => {
  it('answers in plain words and never reaches the database with an invalid rating or review', async () => {
    const noStars = await saveCourseReview(courseId, { rating: 0, body: '' })
    expect(noStars).toEqual({ ok: false, error: 'Choose from 1 to 5 stars.', fieldErrors: { rating: ['Choose from 1 to 5 stars.'] } })
    const tooLong = await saveCourseReview(courseId, { rating: 4, body: 'a'.repeat(2001) })
    expect(tooLong).toMatchObject({ ok: false, fieldErrors: { body: ['Your review can be at most 2,000 characters.'] } })
    const notANumber = await saveCourseReview(courseId, { rating: Number.NaN })
    expect(notANumber.ok ? '' : notANumber.error).not.toMatch(RAW_WORDING)
    expect(mocks.saveReview).not.toHaveBeenCalled()
  })

  it('saves for the signed-in member and turns refusals into plain messages', async () => {
    mocks.saveReview.mockResolvedValueOnce({ id: 'r1', rating: 5, body: '', status: 'pending', updatedAt: '2026-10-10T00:00:00.000Z' })
    expect(await saveCourseReview(courseId, { rating: 5 })).toMatchObject({ ok: true, review: { status: 'pending' } })
    expect(mocks.saveReview).toHaveBeenCalledWith('member-1', courseId, { rating: 5, body: '' })

    mocks.saveReview.mockRejectedValueOnce(new Error('review_progress_too_low'))
    expect(await saveCourseReview(courseId, { rating: 5 })).toEqual({ ok: false, error: 'You can rate this course once you’ve completed at least 20% of it.' })
    mocks.saveReview.mockRejectedValueOnce(new Error('review_blocked'))
    expect(await saveCourseReview(courseId, { rating: 1, body: 'x' })).toMatchObject({ ok: false, error: expect.stringContaining('community safety rules') })
  })
})

describe('decideCourseReview', () => {
  it('needs a platform administrator with an authenticator app', async () => {
    mocks.adminActionMfaMissing.mockResolvedValueOnce(true)
    expect(await decideCourseReview({ reviewId: '66666666-6666-4666-8666-666666666666', decision: 'approved' })).toEqual({ ok: false, error: 'Turn on your authenticator app.' })
    mocks.decideReview.mockRejectedValueOnce(new Error('admin_forbidden'))
    expect(await decideCourseReview({ reviewId: '66666666-6666-4666-8666-666666666666', decision: 'approved' })).toEqual({ ok: false, error: 'You do not have permission to moderate platform content.' })
    expect(await decideCourseReview({ reviewId: 'not-a-review', decision: 'approved' })).toMatchObject({ ok: false })
  })
})

describe('postCourseAnnouncement', () => {
  it('gives a plain message under each field', async () => {
    const result = await postCourseAnnouncement(courseId, { title: '   ', body: 'x'.repeat(5001) })
    expect(result).toEqual({
      ok: false,
      error: 'Add a title.',
      fieldErrors: { title: ['Add a title.'], body: ['The announcement can be at most 5,000 characters.'] },
    })
    expect(mocks.postAnnouncement).not.toHaveBeenCalled()
  })

  it('posts as the signed-in member, refuses blocked text, and explains the limit and missing access', async () => {
    mocks.postAnnouncement.mockResolvedValueOnce({ id: 'a1', courseId, title: 'Hello', body: 'Welcome aboard.', createdAt: '2026-10-10T00:00:00.000Z', recipientCount: 3 })
    expect(await postCourseAnnouncement(courseId, { title: ' Hello ', body: 'Welcome aboard.\r\n' })).toMatchObject({ ok: true, announcement: { recipientCount: 3 } })
    expect(mocks.postAnnouncement).toHaveBeenCalledWith('member-1', courseId, { title: 'Hello', body: 'Welcome aboard.' })

    expect(await postCourseAnnouncement(courseId, { title: 'Offer', body: 'Send me your OTP to unlock the certificate.' })).toMatchObject({ ok: false, error: expect.stringContaining('community safety rules') })
    mocks.postAnnouncement.mockRejectedValueOnce(new Error('announcement_rate_limited'))
    expect(await postCourseAnnouncement(courseId, { title: 'Four', body: 'Text' })).toEqual({ ok: false, error: 'You can send up to 3 announcements per course in 24 hours. Please try again later.' })
    mocks.postAnnouncement.mockRejectedValueOnce(new Error('announcement_forbidden'))
    expect(await postCourseAnnouncement(courseId, { title: 'Hi', body: 'Text' })).toEqual({ ok: false, error: 'Only the people who run this course can message its learners.' })
  })
})

describe('course community actions', () => {
  it('links for the signed-in member and explains refusals', async () => {
    mocks.setLink.mockResolvedValueOnce({ liveCourseId: courseId, groupId: null })
    expect(await linkCourseCommunity(courseId, null)).toEqual({ ok: true, groupId: null })
    expect(mocks.setLink).toHaveBeenCalledWith('member-1', courseId, null)
    mocks.setLink.mockRejectedValueOnce(new Error('community_not_allowed'))
    expect(await linkCourseCommunity(courseId, '44444444-4444-4444-8444-444444444444')).toMatchObject({ ok: false, error: expect.stringContaining('owner or admin') })
    expect(await linkCourseCommunity(courseId, 'nope')).toEqual({ ok: false, error: 'Choose one of the communities in the list.' })
  })

  it('opens the community page after the server check, or says why not', async () => {
    mocks.openDiscussion.mockResolvedValueOnce({ slug: 'fixture-deck', granted: true })
    await expect(openCourseDiscussion(courseId)).rejects.toThrow('NEXT_REDIRECT:/community/fixture-deck')
    expect(mocks.openDiscussion).toHaveBeenCalledWith('member-1', courseId)
    mocks.openDiscussion.mockRejectedValueOnce(new Error('discussion_not_enrolled'))
    expect(await openCourseDiscussion(courseId)).toEqual({ ok: false, error: 'The course discussion is for learners enrolled in this course.' })
  })
})
