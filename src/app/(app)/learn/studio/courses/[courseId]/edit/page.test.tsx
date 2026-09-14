import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getMentorApplicationState: vi.fn(),
  getOwnedCourse: vi.fn(),
  getCurriculum: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  capturedInitialValue: null as unknown,
  capturedCourseId: null as string | null,
  capturedSubmitCourseId: null as string | null,
  capturedCurriculumCourseId: null as string | null,
  capturedCurriculum: null as unknown,
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: mocks.notFound }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/learning/repository', () => ({
  learningRepository: { getMentorApplicationState: mocks.getMentorApplicationState },
}))
vi.mock('@/features/learning/course-repository', () => ({
  courseRepository: { getOwnedCourse: mocks.getOwnedCourse },
}))
vi.mock('@/features/learning/mentor-curriculum-repository', () => ({
  mentorCurriculumRepository: { getCurriculum: mocks.getCurriculum },
}))
vi.mock('@/features/learning/components/course-form', () => ({
  CourseForm: ({ initialValue, courseId }: { initialValue: unknown; courseId?: string }) => {
    mocks.capturedInitialValue = initialValue
    mocks.capturedCourseId = courseId ?? null
    return <div data-testid="course-form">Course form</div>
  },
}))
vi.mock('@/features/learning/components/mentor-curriculum-editor', () => ({
  MentorCurriculumEditor: ({ courseId, curriculum }: { courseId: string; curriculum: unknown }) => {
    mocks.capturedCurriculumCourseId = courseId
    mocks.capturedCurriculum = curriculum
    return <div data-testid="mentor-curriculum-editor">Curriculum editor</div>
  },
}))
vi.mock('@/features/learning/components/course-submit-control', () => ({
  CourseSubmitControl: ({ courseId }: { courseId: string }) => {
    mocks.capturedSubmitCourseId = courseId
    return <div data-testid="course-submit-control">Submit control</div>
  },
}))

import EditMentorCoursePage from './page'

afterEach(() => cleanup())

const courseId = '33333333-3333-4333-8333-333333333333'

const draftCourse = {
  id: courseId,
  slug: 'sire-2-readiness-for-tanker-officers',
  title: 'SIRE 2.0 Readiness for Tanker Officers',
  subtitle: 'Practical preparation for inspections and onboard competency',
  description: 'A practical course that helps tanker officers understand inspection readiness, human factors and onboard competency expectations.',
  category: 'SIRE 2.0',
  level: 'advanced',
  language: 'English',
  thumbnailPath: null,
  trailerPath: null,
  learningOutcomes: ['Explain SIRE 2.0 expectations', 'Prepare practical evidence'],
  requirements: ['Tanker officer experience'],
  targetAudience: ['Deck officers', 'Marine superintendents'],
  accessType: 'free',
  priceMinor: 0,
  discountPriceMinor: null,
  currency: 'INR',
  certificateEnabled: false,
  courseFormat: 'recorded',
  status: 'draft',
  adminReviewNote: null,
  updatedAt: '2026-09-14T15:00:00.000Z',
} as const

const curriculum = {
  courseId,
  status: 'draft',
  sections: [{
    id: '44444444-4444-4444-8444-444444444444',
    title: 'Module 1',
    position: 0,
    lessons: [],
  }],
} as const

describe('/learn/studio/courses/[courseId]/edit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.capturedInitialValue = null
    mocks.capturedCourseId = null
    mocks.capturedSubmitCourseId = null
    mocks.capturedCurriculumCourseId = null
    mocks.capturedCurriculum = null
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1', cognitoSub: 'sub-1', email: 'mentor@example.com' })
    mocks.getMentorApplicationState.mockResolvedValue({
      kind: 'mentor',
      applicationId: '11111111-1111-4111-8111-111111111111',
      status: 'approved',
      submittedAt: '2026-09-14T12:00:00.000Z',
      updatedAt: '2026-09-14T14:00:00.000Z',
      adminReviewNote: 'Approved.',
      mentorId: 'mentor-1',
      mentorStatus: 'active',
    })
    mocks.getOwnedCourse.mockResolvedValue(draftCourse)
    mocks.getCurriculum.mockResolvedValue(curriculum)
  })

  it('loads the signed-in mentor owned draft, curriculum and submission control in one editor', async () => {
    render(await EditMentorCoursePage({ params: Promise.resolve({ courseId }) }))

    expect(screen.getByRole('heading', { name: 'Edit course' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /mentor studio/i })).toHaveAttribute('href', '/learn/studio')
    expect(screen.getByText('SIRE 2.0 Readiness for Tanker Officers')).toBeInTheDocument()
    expect(screen.getByTestId('course-form')).toBeInTheDocument()
    expect(screen.getByTestId('mentor-curriculum-editor')).toBeInTheDocument()
    expect(screen.getByTestId('course-submit-control')).toBeInTheDocument()
    expect(mocks.getOwnedCourse).toHaveBeenCalledWith('user-1', courseId)
    expect(mocks.getCurriculum).toHaveBeenCalledWith('user-1', courseId)
    expect(mocks.capturedCourseId).toBe(courseId)
    expect(mocks.capturedCurriculumCourseId).toBe(courseId)
    expect(mocks.capturedCurriculum).toEqual(curriculum)
    expect(mocks.capturedSubmitCourseId).toBe(courseId)
    expect(mocks.capturedInitialValue).toEqual(expect.objectContaining({
      slug: draftCourse.slug,
      title: draftCourse.title,
      category: 'SIRE 2.0',
      learningOutcomes: draftCourse.learningOutcomes,
      accessType: 'free',
      courseFormat: 'recorded',
    }))
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it('shows administrator feedback when a course is returned for changes', async () => {
    mocks.getOwnedCourse.mockResolvedValue({
      ...draftCourse,
      status: 'changes_requested',
      adminReviewNote: 'Please make the learning outcomes more measurable and role-specific.',
    })
    mocks.getCurriculum.mockResolvedValue({ ...curriculum, status: 'changes_requested' })

    render(await EditMentorCoursePage({ params: Promise.resolve({ courseId }) }))

    expect(screen.getByText('Please make the learning outcomes more measurable and role-specific.')).toBeInTheDocument()
    expect(screen.getByTestId('course-form')).toBeInTheDocument()
    expect(screen.getByTestId('mentor-curriculum-editor')).toBeInTheDocument()
    expect(screen.getByTestId('course-submit-control')).toBeInTheDocument()
  })

  it('returns users without active mentor access to Teach before reading course data', async () => {
    mocks.getMentorApplicationState.mockResolvedValue({ kind: 'none' })

    await EditMentorCoursePage({ params: Promise.resolve({ courseId }) })

    expect(mocks.redirect).toHaveBeenCalledWith('/learn/teach')
    expect(mocks.getOwnedCourse).not.toHaveBeenCalled()
    expect(mocks.getCurriculum).not.toHaveBeenCalled()
  })

  it('uses not found when the owned course does not exist', async () => {
    mocks.getOwnedCourse.mockResolvedValue(null)

    await EditMentorCoursePage({ params: Promise.resolve({ courseId }) })

    expect(mocks.notFound).toHaveBeenCalled()
    expect(mocks.getCurriculum).not.toHaveBeenCalled()
    expect(mocks.capturedInitialValue).toBeNull()
    expect(mocks.capturedSubmitCourseId).toBeNull()
  })

  it('fails closed when the owned curriculum cannot be resolved', async () => {
    mocks.getCurriculum.mockResolvedValue(null)

    await EditMentorCoursePage({ params: Promise.resolve({ courseId }) })

    expect(mocks.notFound).toHaveBeenCalled()
    expect(mocks.capturedCurriculum).toBeNull()
    expect(mocks.capturedSubmitCourseId).toBeNull()
  })

  it.each(['submitted', 'approved', 'published', 'archived'])('returns a non-editable %s course to Mentor Studio before reading curriculum', async (status) => {
    mocks.getOwnedCourse.mockResolvedValue({ ...draftCourse, status })

    await EditMentorCoursePage({ params: Promise.resolve({ courseId }) })

    expect(mocks.redirect).toHaveBeenCalledWith('/learn/studio')
    expect(mocks.getCurriculum).not.toHaveBeenCalled()
    expect(mocks.capturedInitialValue).toBeNull()
    expect(mocks.capturedSubmitCourseId).toBeNull()
  })
})
