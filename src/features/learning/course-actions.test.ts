import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseDraftInput } from './course-repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  createCourse: vi.fn(),
  updateCourse: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./course-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('./course-repository')>()
  return {
    ...original,
    courseRepository: {
      createCourse: mocks.createCourse,
      updateCourse: mocks.updateCourse,
    },
  }
})

import { createCourseDraft, updateCourseDraft } from './course-actions'

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
    mocks.updateCourse.mockResolvedValue(true)
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

  it('rejects an invalid course id before authentication on update', async () => {
    const result = await updateCourseDraft('not-a-uuid', validInput())

    expect(result.ok).toBe(false)
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.updateCourse).not.toHaveBeenCalled()
  })

  it('updates an owned draft with authenticated identity and refreshes Studio', async () => {
    await expect(updateCourseDraft(courseId, validInput())).resolves.toEqual({ ok: true })

    expect(mocks.updateCourse).toHaveBeenCalledWith('user-1', courseId, expect.objectContaining({
      slug: 'sire-2-readiness-for-tanker-officers',
      title: 'SIRE 2.0 Readiness for Tanker Officers',
    }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/studio')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/studio/courses')
  })

  it('returns safe copy when mentor access is unavailable', async () => {
    mocks.createCourse.mockRejectedValueOnce(new Error('mentor_required'))

    await expect(createCourseDraft(validInput())).resolves.toEqual({
      ok: false,
      error: 'Approved mentor access is required to manage courses.',
    })
  })

  it('returns safe copy when a submitted course is no longer editable', async () => {
    mocks.updateCourse.mockRejectedValueOnce(new Error('course_edit_forbidden'))

    await expect(updateCourseDraft(courseId, validInput())).resolves.toEqual({
      ok: false,
      error: 'This course cannot be edited while it is in review or published.',
    })
  })
})
