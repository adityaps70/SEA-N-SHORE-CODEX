import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CourseEditConflictError,
  CourseEditLockedError,
  CourseSubmissionReadinessError,
  type CourseDraftInput,
} from './course-repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  createCourse: vi.fn(),
  updateCourse: vi.fn(),
  submitCourse: vi.fn(),
  withdrawCourse: vi.fn(),
  getManagedCoursePublisher: vi.fn(),
  revalidatePath: vi.fn(),
  requireCapability: vi.fn(async () => undefined),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ requireCapability: mocks.requireCapability }))
vi.mock('./course-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('./course-repository')>()
  return {
    ...original,
    courseRepository: {
      createCourse: mocks.createCourse,
      updateCourse: mocks.updateCourse,
      submitCourse: mocks.submitCourse,
      withdrawCourse: mocks.withdrawCourse,
      getManagedCoursePublisher: mocks.getManagedCoursePublisher,
    },
  }
})

import { createCourseDraft, submitCourseForReview, updateCourseDraft, withdrawCourseFromReview } from './course-actions'

const courseId = '33333333-3333-4333-8333-333333333333'

function validInput(overrides: Partial<CourseDraftInput> = {}): CourseDraftInput {
  return {
    slug: ' SIRE-2-Readiness-for-Tanker-Officers ',
    title: ' SIRE 2.0 Readiness for Tanker Officers ',
    subtitle: ' Practical preparation for inspections and onboard competency ',
    description: ' A practical maritime course that helps tanker officers understand SIRE 2.0 expectations, prepare evidence and improve onboard competency before an inspection. ',
    category: ' SIRE 2.0 ',
    level: 'advanced',
    language: ' English ',
    thumbnailPath: null,
    trailerPath: null,
    learningOutcomes: [' Understand SIRE 2.0 expectations ', 'understand SIRE 2.0 expectations', 'Prepare practical onboard evidence'],
    requirements: [' Active or recent tanker experience '],
    targetAudience: [' Deck Officers ', 'Marine Superintendents'],
    accessType: 'free',
    priceMinor: 0,
    discountPriceMinor: null,
    currency: ' inr ',
    certificateEnabled: true,
    courseFormat: 'recorded',
    ...overrides,
  }
}

describe('learning course server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1', cognitoSub: 'sub-1', email: 'captain@example.com' })
    mocks.createCourse.mockResolvedValue({ courseId })
    mocks.updateCourse.mockResolvedValue({ revision: 4, updatedAt: '2026-09-27T09:02:00.000Z' })
    mocks.submitCourse.mockResolvedValue(true)
    mocks.withdrawCourse.mockResolvedValue(true)
    mocks.getManagedCoursePublisher.mockResolvedValue({ companyId: null })
    mocks.requireCapability.mockResolvedValue(undefined)
  })

  it('rejects inconsistent paid pricing before authentication or mutation', async () => {
    const result = await createCourseDraft(validInput({ accessType: 'paid', priceMinor: 0 }))

    expect(result.ok).toBe(false)
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.createCourse).not.toHaveBeenCalled()
  })

  it('creates a normalized course draft for the authenticated mentor', async () => {
    await expect(createCourseDraft(validInput())).resolves.toEqual({ ok: true, courseId })

    expect(mocks.createCourse).toHaveBeenCalledWith('user-1', {
      slug: 'sire-2-readiness-for-tanker-officers',
      title: 'SIRE 2.0 Readiness for Tanker Officers',
      subtitle: 'Practical preparation for inspections and onboard competency',
      description: 'A practical maritime course that helps tanker officers understand SIRE 2.0 expectations, prepare evidence and improve onboard competency before an inspection.',
      category: 'SIRE 2.0',
      level: 'advanced',
      language: 'English',
      thumbnailPath: null,
      trailerPath: null,
      learningOutcomes: ['Understand SIRE 2.0 expectations', 'Prepare practical onboard evidence'],
      requirements: ['Active or recent tanker experience'],
      targetAudience: ['Deck Officers', 'Marine Superintendents'],
      accessType: 'free',
      priceMinor: 0,
      discountPriceMinor: null,
      currency: 'INR',
      certificateEnabled: true,
      courseFormat: 'recorded',
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/studio')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/studio/courses')
  })



  it('creates an organization course draft with an explicit organization publisher', async () => {
    const companyId = '44444444-4444-4444-8444-444444444444'

    await expect(createCourseDraft({
      ...validInput(),
      publisherType: 'organization',
      companyId,
    })).resolves.toEqual({ ok: true, courseId })

    expect(mocks.createCourse).toHaveBeenCalledWith('user-1', expect.objectContaining({
      publisherType: 'organization',
      companyId,
      slug: 'sire-2-readiness-for-tanker-officers',
      title: 'SIRE 2.0 Readiness for Tanker Officers',
    }))
    expect(mocks.requireCapability).not.toHaveBeenCalled()
  })

  it('rejects an invalid course id before authentication on update', async () => {
    const result = await updateCourseDraft('not-a-uuid', validInput())

    expect(result.ok).toBe(false)
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.updateCourse).not.toHaveBeenCalled()
  })

  it('updates an owned draft with authenticated identity and refreshes Studio', async () => {
    await expect(updateCourseDraft(courseId, validInput(), 3)).resolves.toEqual({
      ok: true,
      revision: 4,
      savedAt: '2026-09-27T09:02:00.000Z',
      course: expect.objectContaining({
        slug: 'sire-2-readiness-for-tanker-officers',
        title: 'SIRE 2.0 Readiness for Tanker Officers',
        learningOutcomes: ['Understand SIRE 2.0 expectations', 'Prepare practical onboard evidence'],
        currency: 'INR',
      }),
    })

    expect(mocks.updateCourse).toHaveBeenCalledWith('user-1', courseId, expect.objectContaining({
      slug: 'sire-2-readiness-for-tanker-officers',
      title: 'SIRE 2.0 Readiness for Tanker Officers',
    }), { expectedRevision: 3 })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/studio')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/studio/courses')
  })

  it('rejects an invalid course id before authentication on submit', async () => {
    await expect(submitCourseForReview('not-a-uuid')).resolves.toEqual({ ok: false, error: 'Invalid course.' })

    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.submitCourse).not.toHaveBeenCalled()
  })

  it('requires central personal course publishing capability when a personal draft is submitted for review', async () => {
    await expect(submitCourseForReview(courseId)).resolves.toEqual({ ok: true })

    expect(mocks.requireCapability).toHaveBeenCalledWith('user-1', 'course.publish')
  })

  it('requires organization-scoped course publishing capability for an organization course', async () => {
    const companyId = '44444444-4444-4444-8444-444444444444'
    mocks.getManagedCoursePublisher.mockResolvedValueOnce({ companyId })

    await expect(submitCourseForReview(courseId)).resolves.toEqual({ ok: true })

    expect(mocks.requireCapability).toHaveBeenCalledWith(
      'user-1',
      'course.publish',
      { companyId },
    )
  })

  it('fails closed when course publishing entitlement or trainer verification is missing', async () => {
    mocks.requireCapability.mockRejectedValueOnce(new Error('capability_required'))

    await expect(submitCourseForReview(courseId)).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/creator pro|organization pro|course publishing/i),
    })
    expect(mocks.submitCourse).not.toHaveBeenCalled()
  })

  it('submits an owned editable course for review and refreshes its Studio surfaces', async () => {
    await expect(submitCourseForReview(courseId)).resolves.toEqual({ ok: true })

    expect(mocks.submitCourse).toHaveBeenCalledWith('user-1', courseId, { expectedRevision: null })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/studio')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/studio/courses')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/learn/studio/courses/${courseId}/edit`)
  })

  it('returns safe copy when mentor access is unavailable', async () => {
    mocks.createCourse.mockRejectedValueOnce(new Error('mentor_required'))

    await expect(createCourseDraft(validInput())).resolves.toEqual({
      ok: false,
      error: 'Approved mentor access is required to manage personal courses.',
    })
  })

  it('returns safe copy when a submitted course is no longer editable', async () => {
    mocks.updateCourse.mockRejectedValueOnce(new Error('course_edit_forbidden'))

    await expect(updateCourseDraft(courseId, validInput())).resolves.toEqual({
      ok: false,
      error: 'Your changes were not saved because this course is in review or published. Reload the page to see its current status.',
    })
  })

  it.each([
    ['submitted', /not saved because this course is in review\. Withdraw it from review/],
    ['published', /not saved because this course is published/],
    ['archived', /not saved because this course is archived/],
  ] as const)('tells the trainer exactly why a save on a %s course was refused', async (status, copy) => {
    mocks.updateCourse.mockRejectedValueOnce(new CourseEditLockedError(status))

    const result = await updateCourseDraft(courseId, validInput(), 2)

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toMatch(copy)
  })

  it('refuses a stale save instead of overwriting newer changes', async () => {
    mocks.updateCourse.mockRejectedValueOnce(new CourseEditConflictError(5))

    await expect(updateCourseDraft(courseId, validInput(), 3)).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/saved newer changes to this course .* your changes were not saved/i),
    })
  })

  it('names the field when course details are invalid', async () => {
    await expect(updateCourseDraft(courseId, validInput({ description: 'Too short' }), 1)).resolves.toEqual({
      ok: false,
      error: 'Course description needs at least 40 characters so learners understand what the course covers.',
    })
    await expect(updateCourseDraft(courseId, validInput({ subtitle: 'ab' }), 1)).resolves.toEqual({
      ok: false,
      error: 'Subtitle needs at least 4 characters, or leave it empty.',
    })
    expect(mocks.updateCourse).not.toHaveBeenCalled()
  })

  it('submits against the revision the trainer just saved', async () => {
    await expect(submitCourseForReview(courseId, 7)).resolves.toEqual({ ok: true })

    expect(mocks.submitCourse).toHaveBeenCalledWith('user-1', courseId, { expectedRevision: 7 })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/learning/courses')
  })

  it('refuses to submit when the stored details are newer than what the trainer saved', async () => {
    mocks.submitCourse.mockRejectedValueOnce(new CourseEditConflictError(8))

    await expect(submitCourseForReview(courseId, 7)).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/changed after your last save .* was not submitted/i),
    })
  })

  it('returns safe copy when course workflow no longer permits submission', async () => {
    mocks.submitCourse.mockRejectedValueOnce(new Error('course_submit_forbidden'))

    await expect(submitCourseForReview(courseId)).resolves.toEqual({
      ok: false,
      error: 'This course is already in review or published, so it can’t be submitted again. Reload the page to see its current status.',
    })
  })

  it('withdraws an in-review course for the authenticated manager and refreshes both queues', async () => {
    await expect(withdrawCourseFromReview(courseId)).resolves.toEqual({ ok: true })

    expect(mocks.withdrawCourse).toHaveBeenCalledWith('user-1', courseId)
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/learn/studio/courses/${courseId}/edit`)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/learning/courses')
  })

  it('explains when there is nothing to withdraw', async () => {
    mocks.withdrawCourse.mockRejectedValueOnce(new Error('course_withdraw_forbidden'))

    await expect(withdrawCourseFromReview(courseId)).resolves.toEqual({
      ok: false,
      error: 'This course is no longer waiting for review, so there is nothing to withdraw. Reload the page to see its current status.',
    })
    await expect(withdrawCourseFromReview('nope')).resolves.toEqual({ ok: false, error: 'Invalid course.' })
  })

  it.each([
    [
      new CourseSubmissionReadinessError('course_curriculum_empty'),
      'Add at least one curriculum section before submitting for review.',
    ],
    [
      new CourseSubmissionReadinessError('course_section_empty', { sectionTitle: 'Module 1' }),
      'Section “Module 1” needs at least one published material.',
    ],
    [
      new CourseSubmissionReadinessError('course_material_content_missing', { materialTitle: 'Inspection evidence', materialType: 'article' }),
      'Material “Inspection evidence” is missing required article content.',
    ],
    [
      new CourseSubmissionReadinessError('course_material_content_missing', { materialTitle: 'Bridge walkthrough', materialType: 'video' }),
      'Material “Bridge walkthrough” needs its required content or uploaded file.',
    ],
    [
      new CourseSubmissionReadinessError('course_material_content_missing', { materialTitle: 'OCIMF explainer', materialType: 'external_embed' }),
      'Material “OCIMF explainer” needs an embeddable URL.',
    ],
    [
      new CourseSubmissionReadinessError('course_material_release_invalid', { materialTitle: 'Day 3 drill' }),
      'Material “Day 3 drill” has an invalid release schedule.',
    ],
    [
      new CourseSubmissionReadinessError('course_material_prerequisite_invalid', { materialTitle: 'Assessment' }),
      'Material “Assessment” must depend on another published material in this course.',
    ],
    [
      new CourseSubmissionReadinessError('course_material_completion_invalid', { materialTitle: 'Bridge walkthrough' }),
      'Material “Bridge walkthrough” has a completion rule that does not match its material type.',
    ],
    [
      new CourseSubmissionReadinessError('course_assignment_missing', { materialTitle: 'Onboard task' }),
      'Assignment “Onboard task” needs instructions before submission.',
    ],
    [
      new CourseSubmissionReadinessError('course_scorm_not_ready', { materialTitle: 'Interactive SIRE drill' }),
      'SCORM material “Interactive SIRE drill” must finish processing successfully before submission.',
    ],
    [
      new CourseSubmissionReadinessError('course_activity_not_supported', { materialTitle: 'Live mentor session', materialType: 'live_session' }),
      'Material “Live mentor session” uses live session, which cannot be published until native attendance completion is connected.',
    ],
    [
      new CourseSubmissionReadinessError('course_quiz_missing', { materialTitle: 'SIRE knowledge check' }),
      'Quiz “SIRE knowledge check” needs an assessment definition before submission.',
    ],
    [
      new CourseSubmissionReadinessError('course_quiz_pass_invalid', { materialTitle: 'SIRE knowledge check' }),
      'Quiz “SIRE knowledge check” needs a pass percentage from 1 to 100.',
    ],
    [
      new CourseSubmissionReadinessError('course_quiz_questions_missing', { materialTitle: 'SIRE knowledge check' }),
      'Quiz “SIRE knowledge check” needs at least one question.',
    ],
    [
      new CourseSubmissionReadinessError('course_quiz_options_invalid', { materialTitle: 'SIRE knowledge check', questionNumber: 2 }),
      'Question 2 in quiz “SIRE knowledge check” needs at least two answer options.',
    ],
    [
      new CourseSubmissionReadinessError('course_quiz_correct_answer_invalid', { materialTitle: 'SIRE knowledge check', questionNumber: 3 }),
      'Question 3 in quiz “SIRE knowledge check” must have exactly one correct answer.',
    ],
  ])('returns actionable native material readiness copy on submit', async (error, expectedCopy) => {
    mocks.submitCourse.mockRejectedValueOnce(error)

    await expect(submitCourseForReview(courseId)).resolves.toEqual({
      ok: false,
      error: expectedCopy,
    })
  })
})
