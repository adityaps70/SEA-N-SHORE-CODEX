import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  reviewMentorApplication: vi.fn(),
  reviewCourse: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./admin-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('./admin-repository')>()
  return {
    ...original,
    learningAdminRepository: {
      reviewMentorApplication: mocks.reviewMentorApplication,
      reviewCourse: mocks.reviewCourse,
    },
  }
})

import { reviewCourse, reviewMentorApplication } from './admin-actions'

const applicationId = '11111111-1111-4111-8111-111111111111'
const courseId = '22222222-2222-4222-8222-222222222222'

describe('learning mentor review server action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'admin-1', cognitoSub: 'admin-sub', email: 'admin@example.com' })
    mocks.reviewMentorApplication.mockResolvedValue({ applicationId, status: 'approved', mentorId: 'mentor-1' })
  })

  it('rejects malformed application ids before authentication', async () => {
    const result = await reviewMentorApplication('invalid', 'approved', null)

    expect(result.ok).toBe(false)
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.reviewMentorApplication).not.toHaveBeenCalled()
  })

  it('requires a review note before requesting changes or rejecting', async () => {
    const result = await reviewMentorApplication(applicationId, 'changes_requested', ' ')

    expect(result.ok).toBe(false)
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.reviewMentorApplication).not.toHaveBeenCalled()
  })

  it('approves through the authenticated platform administrator and refreshes review surfaces', async () => {
    await expect(reviewMentorApplication(applicationId, 'approved', null)).resolves.toEqual({
      ok: true,
      status: 'approved',
      mentorId: 'mentor-1',
    })

    expect(mocks.reviewMentorApplication).toHaveBeenCalledWith('admin-1', applicationId, 'approved', null)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/learning')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/teach')
  })

  it('normalizes reviewer notes before requesting changes', async () => {
    mocks.reviewMentorApplication.mockResolvedValueOnce({ applicationId, status: 'changes_requested', mentorId: null })

    await expect(reviewMentorApplication(applicationId, 'changes_requested', '  Please clarify LNG teaching experience.  ')).resolves.toEqual({
      ok: true,
      status: 'changes_requested',
      mentorId: null,
    })

    expect(mocks.reviewMentorApplication).toHaveBeenCalledWith(
      'admin-1',
      applicationId,
      'changes_requested',
      'Please clarify LNG teaching experience.',
    )
  })

  it('fails closed with safe copy when repository authorization denies review', async () => {
    mocks.reviewMentorApplication.mockRejectedValueOnce(new Error('admin_forbidden'))

    await expect(reviewMentorApplication(applicationId, 'approved', null)).resolves.toEqual({
      ok: false,
      error: 'You are not authorized to review trainer verification applications.',
    })
  })
})

describe('learning course review server action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'admin-1', cognitoSub: 'admin-sub', email: 'admin@example.com' })
    mocks.reviewCourse.mockResolvedValue({ courseId, status: 'approved' })
  })

  it('rejects malformed course ids before authentication or mutation', async () => {
    const result = await reviewCourse('invalid', 'approved', null)

    expect(result).toEqual({ ok: false, error: 'Invalid course review request.' })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.reviewCourse).not.toHaveBeenCalled()
  })

  it('requires reviewer feedback before requesting course changes', async () => {
    const result = await reviewCourse(courseId, 'changes_requested', '   ')

    expect(result).toEqual({ ok: false, error: 'A reviewer note is required when requesting course changes.' })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.reviewCourse).not.toHaveBeenCalled()
  })

  it('approves a submitted course as the authenticated administrator and refreshes all learning surfaces', async () => {
    await expect(reviewCourse(courseId, 'approved', null)).resolves.toEqual({ ok: true, status: 'approved' })

    expect(mocks.reviewCourse).toHaveBeenCalledWith('admin-1', courseId, 'approved', null)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/learning')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/learning/courses')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/studio')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/studio/courses')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/learn/studio/courses/${courseId}/edit`)
  })

  it('publishes an approved course without requiring a note', async () => {
    mocks.reviewCourse.mockResolvedValueOnce({ courseId, status: 'published' })

    await expect(reviewCourse(courseId, 'published', null)).resolves.toEqual({ ok: true, status: 'published' })
    expect(mocks.reviewCourse).toHaveBeenCalledWith('admin-1', courseId, 'published', null)
  })

  it('normalizes reviewer feedback before requesting changes', async () => {
    mocks.reviewCourse.mockResolvedValueOnce({ courseId, status: 'changes_requested' })

    await expect(reviewCourse(
      courseId,
      'changes_requested',
      '  Make the outcomes measurable and add a tanker-specific example.  ',
    )).resolves.toEqual({ ok: true, status: 'changes_requested' })

    expect(mocks.reviewCourse).toHaveBeenCalledWith(
      'admin-1',
      courseId,
      'changes_requested',
      'Make the outcomes measurable and add a tanker-specific example.',
    )
  })

  it.each([
    ['admin_forbidden', 'You are not authorized to review learning courses.'],
    ['course_not_found', 'This learning course could not be found.'],
    ['course_transition_forbidden', 'This course cannot move to that review state.'],
    ['course_review_note_required', 'A reviewer note is required when requesting course changes.'],
  ])('maps %s to safe course-review copy', async (code, message) => {
    mocks.reviewCourse.mockRejectedValueOnce(new Error(code))

    await expect(reviewCourse(courseId, 'approved', null)).resolves.toEqual({ ok: false, error: message })
  })
})
