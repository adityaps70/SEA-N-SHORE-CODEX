import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getOwnedCourse: vi.fn(),
  getCurriculum: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  capturedInitialValue: null as unknown,
  capturedCourseId: null as string | null,
  capturedSubmitCourseId: null as string | null,
  capturedCurriculumCourseId: null as string | null,
  capturedCurriculum: null as unknown,
  capturedFormReadOnly: null as boolean | null,
  capturedCurriculumReadOnly: null as boolean | null,
  capturedRevision: null as number | null,
  capturedResubmission: null as boolean | null,
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: mocks.notFound }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/learning/course-repository', () => ({
  courseRepository: { getOwnedCourse: mocks.getOwnedCourse },
}))
vi.mock('@/features/learning/mentor-material-repository', () => ({
  mentorMaterialRepository: { getCurriculum: mocks.getCurriculum },
}))
vi.mock('@/features/learning/components/course-edit-session', () => ({
  CourseEditSession: ({ children, initialDetailsRevision }: { children: React.ReactNode; initialDetailsRevision?: number }) => {
    mocks.capturedRevision = initialDetailsRevision ?? null
    return <div data-testid="course-edit-session">{children}</div>
  },
}))
vi.mock('@/features/learning/components/course-form', () => ({
  CourseForm: ({ initialValue, courseId, readOnly }: { initialValue: unknown; courseId?: string; readOnly?: boolean }) => {
    mocks.capturedInitialValue = initialValue
    mocks.capturedCourseId = courseId ?? null
    mocks.capturedFormReadOnly = Boolean(readOnly)
    return <div data-testid="course-form">Course form</div>
  },
}))
vi.mock('@/features/learning/components/mentor-curriculum-editor', () => ({
  MentorCurriculumEditor: ({ courseId, curriculum, readOnly }: { courseId: string; curriculum: unknown; readOnly?: boolean }) => {
    mocks.capturedCurriculumCourseId = courseId
    mocks.capturedCurriculum = curriculum
    mocks.capturedCurriculumReadOnly = Boolean(readOnly)
    return <div data-testid="mentor-curriculum-editor">Curriculum editor</div>
  },
}))
vi.mock('@/features/learning/components/course-submit-control', () => ({
  CourseSubmitControl: ({ courseId, resubmission }: { courseId: string; resubmission?: boolean }) => {
    mocks.capturedSubmitCourseId = courseId
    mocks.capturedResubmission = Boolean(resubmission)
    return <div data-testid="course-submit-control">Submit control</div>
  },
}))
vi.mock('@/features/learning/components/course-withdraw-control', () => ({
  CourseWithdrawControl: ({ courseId }: { courseId: string }) => <div data-testid="course-withdraw-control">withdraw:{courseId}</div>,
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
  detailsRevision: 4,
  lastReview: null,
  submittedAt: null,
  publisherName: 'Capt. Mentor',
} as const

const curriculum = {
  courseId,
  status: 'draft',
  navigationMode: 'free',
  sections: [{
    id: '44444444-4444-4444-8444-444444444444',
    title: 'Module 1',
    position: 0,
    materials: [],
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
    mocks.capturedFormReadOnly = null
    mocks.capturedCurriculumReadOnly = null
    mocks.capturedRevision = null
    mocks.capturedResubmission = null
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1', cognitoSub: 'sub-1', email: 'mentor@example.com' })
    mocks.getOwnedCourse.mockResolvedValue(draftCourse)
    mocks.getCurriculum.mockResolvedValue(curriculum)
  })

  it('loads the signed-in creator owned draft, curriculum and submission control in one editor', async () => {
    render(await EditMentorCoursePage({ params: Promise.resolve({ courseId }) }))
    // Phones: page bar back to Studio and the amber "works best on a computer" note.
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/learn/studio')
    expect(screen.getByRole('note')).toHaveTextContent('work best on a computer')
    expect(screen.getByRole('note')).toHaveClass('md:hidden', 'bg-amber-50')

    expect(screen.getByRole('heading', { name: 'Edit course' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /learning studio/i })).toHaveAttribute('href', '/learn/studio')
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
    expect(mocks.capturedFormReadOnly).toBe(false)
    expect(mocks.capturedCurriculumReadOnly).toBe(false)
    expect(mocks.capturedRevision).toBe(4)
    expect(mocks.capturedResubmission).toBe(false)
  })

  it('shows administrator feedback when a course is returned for changes', async () => {
    mocks.getOwnedCourse.mockResolvedValue({
      ...draftCourse,
      status: 'changes_requested',
      adminReviewNote: 'Please make the learning outcomes more measurable and role-specific.',
      lastReview: {
        decision: 'changes_requested',
        note: 'Please make the learning outcomes more measurable and role-specific.',
        reviewedAt: '2026-09-20T06:30:00.000Z',
      },
    })
    mocks.getCurriculum.mockResolvedValue({ ...curriculum, status: 'changes_requested' })

    render(await EditMentorCoursePage({ params: Promise.resolve({ courseId }) }))

    expect(screen.getByText('Changes requested by Sea N Shore review')).toBeInTheDocument()
    expect(screen.getByText('Please make the learning outcomes more measurable and role-specific.')).toBeInTheDocument()
    expect(mocks.capturedResubmission).toBe(true)
    expect(mocks.capturedFormReadOnly).toBe(false)
    expect(screen.getByTestId('course-form')).toBeInTheDocument()
    expect(screen.getByTestId('mentor-curriculum-editor')).toBeInTheDocument()
    expect(screen.getByTestId('course-submit-control')).toBeInTheDocument()
  })

  it('relies on unified course ownership instead of a personal trainer pre-gate', async () => {
    render(await EditMentorCoursePage({ params: Promise.resolve({ courseId }) }))

    expect(mocks.getOwnedCourse).toHaveBeenCalledWith('user-1', courseId)
    expect(mocks.redirect).not.toHaveBeenCalledWith('/learn/teach')
    expect(screen.getByTestId('course-form')).toBeInTheDocument()
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

  it('shows an in-review course read-only with the reviewer’s earlier note and a way to withdraw it', async () => {
    mocks.getOwnedCourse.mockResolvedValue({
      ...draftCourse,
      status: 'submitted',
      submittedAt: '2026-09-27T09:02:00.000Z',
      lastReview: { decision: 'changes_requested', note: 'Add a vetting checklist.', reviewedAt: '2026-09-20T06:30:00.000Z' },
    })

    render(await EditMentorCoursePage({ params: Promise.resolve({ courseId }) }))

    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'View course' })).toBeInTheDocument()
    expect(screen.getByText(/^In review · submitted/)).toBeInTheDocument()
    expect(screen.getByText(/editing is locked while sea n shore reviews this course/i)).toBeInTheDocument()
    expect(screen.getByText('Add a vetting checklist.')).toBeInTheDocument()
    expect(screen.getByTestId('course-withdraw-control')).toHaveTextContent(courseId)
    expect(mocks.capturedFormReadOnly).toBe(true)
    expect(mocks.capturedCurriculumReadOnly).toBe(true)
    expect(screen.queryByTestId('course-submit-control')).not.toBeInTheDocument()
  })

  it.each([
    ['published', /Published · read-only/],
    ['approved', /Published · read-only/],
    ['archived', /Archived · read-only/],
  ])('shows a %s course read-only instead of silently redirecting', async (status, banner) => {
    mocks.getOwnedCourse.mockResolvedValue({ ...draftCourse, status })

    render(await EditMentorCoursePage({ params: Promise.resolve({ courseId }) }))

    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(screen.getByText(banner)).toBeInTheDocument()
    expect(mocks.capturedFormReadOnly).toBe(true)
    expect(mocks.capturedCurriculumReadOnly).toBe(true)
    expect(screen.queryByTestId('course-submit-control')).not.toBeInTheDocument()
    expect(screen.queryByTestId('course-withdraw-control')).not.toBeInTheDocument()
  })
})
